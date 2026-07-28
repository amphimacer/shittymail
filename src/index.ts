import fastify from "fastify";
import fastifyStatic from "@fastify/static";
import nodemailer from "nodemailer";
import { SMTPServer } from "smtp-server";
import { simpleParser } from "mailparser";
import { z } from "zod";
import dotenv from "dotenv";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import dns from "node:dns/promises";
import fs from "node:fs";

dotenv.config();

const app = fastify();

const port = Number(process.env.port);
const smtp_port = Number(process.env.smtp_port);
const smtp_host = process.env.smtp_host;
const smtp_user = process.env.smtp_user;
const smtp_password = process.env.smtp_password;
const api_key = process.env.api_key;
const mail_domain = process.env.mail_domain;
const smtp_listen_host = process.env.smtp_listen_host;
const api_listen_host = process.env.api_listen_host;
const outbound_host = process.env.outbound_host || "";
const outbound_port = Number(process.env.outbound_port || 25);
const outbound_user = process.env.outbound_user || "";
const outbound_password = process.env.outbound_password || "";

if (
    !port ||
    !smtp_port ||
    !smtp_host ||
    !smtp_user ||
    !smtp_password ||
    !api_key ||
    !mail_domain ||
    !smtp_listen_host ||
    !api_listen_host
) {
    throw new Error("missing required environment variables");
}

const domain = mail_domain.toLowerCase();

type User = {
    id: string;
    name: string;
    api_key: string;
    created_at: string;
};

type StoredMail = {
    id: string;
    from: string;
    to: string;
    subject: string;
    text: string;
    html: string;
    date: string;
};

type SentMail = {
    id: string;
    message_id: string;
    from: string;
    to: string[];
    subject: string;
    text: string;
    html: string;
    status: "delivered" | "failed";
    error: string | null;
    user_id: string | null;
    created_at: string;
};

const users = new Map<string, User>();
const users_by_key = new Map<string, User>();
const inboxes = new Map<string, StoredMail[]>();
const sent_mails: SentMail[] = [];

function normalize_address(address: string) {
    return address.trim().toLowerCase();
}

function is_local_address(address: string) {
    return normalize_address(address).endsWith(`@${domain}`);
}

function get_inbox(address: string) {
    const key = normalize_address(address);
    const messages = inboxes.get(key) ?? [];
    return { key, messages };
}

function store_mail(to: string, mail: StoredMail) {
    const key = normalize_address(to);
    const existing = inboxes.get(key) ?? [];
    existing.unshift(mail);
    inboxes.set(key, existing);
}

function make_api_key() {
    return `re_${randomBytes(24).toString("hex")}`;
}

function get_bearer(authorization: string | undefined) {
    if (!authorization) return null;
    const [scheme, token] = authorization.split(" ");
    if (scheme?.toLowerCase() !== "bearer" || !token) return null;
    return token;
}

function require_master(authorization: string | undefined) {
    const token = get_bearer(authorization);
    if (!token || token !== api_key) return null;
    return true;
}

function resolve_auth(authorization: string | undefined) {
    const token = get_bearer(authorization);
    if (!token) return null;
    if (token === api_key) {
        return { kind: "master" as const, user: null };
    }
    const user = users_by_key.get(token);
    if (user) {
        return { kind: "user" as const, user };
    }
    return null;
}

async function resolve_mx(hostname: string) {
    const records = await dns.resolveMx(hostname);
    records.sort((a, b) => a.priority - b.priority);
    if (!records[0]?.exchange) {
        throw new Error(`no mx records for ${hostname}`);
    }
    return records[0].exchange;
}

function create_outbound_transport(host: string) {
    return nodemailer.createTransport({
        host,
        port: outbound_host ? outbound_port : 25,
        secure: false,
        name: domain,
        tls: {
            rejectUnauthorized: false,
        },
        ...(outbound_host && outbound_user && outbound_password
            ? {
                  auth: {
                      user: outbound_user,
                      pass: outbound_password,
                  },
              }
            : {}),
    });
}

async function deliver_local(
    from: string,
    recipients: string[],
    subject: string,
    html: string | undefined,
    text: string | undefined,
) {
    for (const recipient of recipients) {
        store_mail(recipient, {
            id: randomUUID(),
            from,
            to: recipient,
            subject,
            text: text || "",
            html: html || "",
            date: new Date().toISOString(),
        });
    }
}

async function deliver_remote(
    from: string,
    recipients: string[],
    subject: string,
    html: string | undefined,
    text: string | undefined,
) {
    if (outbound_host) {
        const transporter = create_outbound_transport(outbound_host);
        return transporter.sendMail({
            from,
            to: recipients,
            subject,
            html,
            text,
        });
    }

    const grouped = new Map<string, string[]>();

    for (const recipient of recipients) {
        const host = recipient.split("@")[1]?.toLowerCase();
        if (!host) continue;
        const list = grouped.get(host) ?? [];
        list.push(recipient);
        grouped.set(host, list);
    }

    let last_id = "";

    for (const [host, group] of grouped.entries()) {
        const mx = await resolve_mx(host);
        const transporter = create_outbound_transport(mx);
        const info = await transporter.sendMail({
            from,
            to: group,
            subject,
            html,
            text,
        });
        last_id = info.messageId;
    }

    return { messageId: last_id };
}

const email_schema = z.object({
    from: z.string().email(),
    to: z.union([
        z.string().email(),
        z.array(z.string().email()).min(1),
    ]),
    subject: z.string().min(1),
    html: z.string().optional(),
    text: z.string().optional(),
});

const user_schema = z.object({
    name: z.string().min(1).max(64),
});

const smtp_server = new SMTPServer({
    secure: false,
    authOptional: true,
    hideSTARTTLS: true,

    onAuth(auth, _session, callback) {
        if (
            auth.username === smtp_user &&
            auth.password === smtp_password
        ) {
            callback(null, {
                user: smtp_user,
            });
            return;
        }

        callback(new Error("invalid smtp credentials"));
    },

    onRcptTo(address, _session, callback) {
        if (is_local_address(address.address)) {
            callback();
            return;
        }

        callback(new Error("invalid recipient domain"));
    },

    onData(stream, session, callback) {
        simpleParser(stream)
            .then((parsed) => {
                const recipients = session.envelope.rcptTo
                    .map((recipient) => recipient.address)
                    .filter((address) => is_local_address(address));

                if (recipients.length === 0) {
                    callback();
                    return;
                }

                const mail_from = session.envelope.mailFrom;
                const from =
                    parsed.from?.text ||
                    (mail_from && mail_from.address) ||
                    "unknown";

                const mail: StoredMail = {
                    id: randomUUID(),
                    from,
                    to: recipients[0],
                    subject: parsed.subject || "(no subject)",
                    text: parsed.text || "",
                    html: typeof parsed.html === "string" ? parsed.html : "",
                    date: (parsed.date ?? new Date()).toISOString(),
                };

                for (const recipient of recipients) {
                    store_mail(recipient, {
                        ...mail,
                        id: randomUUID(),
                        to: recipient,
                    });
                }

                console.log(`stored mail for ${recipients.join(", ")}: ${mail.subject}`);
                callback();
            })
            .catch(callback);
    },
});

app.get("/health", async () => {
    return {
        status: "ok",
    };
});

app.get("/v1/domain", async () => {
    return {
        domain,
        receive: `<anything>@${domain}`,
    };
});

app.get("/v1/users", async (request, reply) => {
    if (!require_master(request.headers.authorization)) {
        return reply.code(401).send({
            error: {
                message: "invalid api key",
            },
        });
    }

    return {
        users: [...users.values()].map((user) => ({
            id: user.id,
            name: user.name,
            api_key: user.api_key,
            created_at: user.created_at,
        })),
    };
});

app.post("/v1/users", async (request, reply) => {
    if (!require_master(request.headers.authorization)) {
        return reply.code(401).send({
            error: {
                message: "invalid api key",
            },
        });
    }

    const result = user_schema.safeParse(request.body);

    if (!result.success) {
        return reply.code(400).send({
            error: {
                message: "invalid user request",
                details: result.error.flatten(),
            },
        });
    }

    const user: User = {
        id: randomUUID(),
        name: result.data.name,
        api_key: make_api_key(),
        created_at: new Date().toISOString(),
    };

    users.set(user.id, user);
    users_by_key.set(user.api_key, user);

    return reply.code(201).send(user);
});

app.delete<{ Params: { id: string } }>("/v1/users/:id", async (request, reply) => {
    if (!require_master(request.headers.authorization)) {
        return reply.code(401).send({
            error: {
                message: "invalid api key",
            },
        });
    }

    const user = users.get(request.params.id);

    if (!user) {
        return reply.code(404).send({
            error: {
                message: "user not found",
            },
        });
    }

    users.delete(user.id);
    users_by_key.delete(user.api_key);

    return {
        message: "user deleted",
    };
});

app.get("/v1/emails", async (request, reply) => {
    if (!resolve_auth(request.headers.authorization)) {
        return reply.code(401).send({
            error: {
                message: "invalid api key",
            },
        });
    }

    const query = request.query as { q?: string; status?: string };
    let list = [...sent_mails];

    if (query.status && query.status !== "all") {
        list = list.filter((mail) => mail.status === query.status);
    }

    if (query.q) {
        const q = query.q.toLowerCase();
        list = list.filter((mail) => {
            return (
                mail.subject.toLowerCase().includes(q) ||
                mail.from.toLowerCase().includes(q) ||
                mail.to.some((to) => to.toLowerCase().includes(q))
            );
        });
    }

    return {
        count: list.length,
        emails: list.map((mail) => ({
            id: mail.id,
            to: mail.to,
            from: mail.from,
            subject: mail.subject,
            status: mail.status,
            created_at: mail.created_at,
            user_id: mail.user_id,
        })),
    };
});

app.get<{ Params: { id: string } }>("/v1/emails/:id", async (request, reply) => {
    if (!resolve_auth(request.headers.authorization)) {
        return reply.code(401).send({
            error: {
                message: "invalid api key",
            },
        });
    }

    const mail = sent_mails.find((item) => item.id === request.params.id);

    if (!mail) {
        return reply.code(404).send({
            error: {
                message: "email not found",
            },
        });
    }

    return mail;
});

app.post("/v1/emails", async (request, reply) => {
    const auth = resolve_auth(request.headers.authorization);

    if (!auth) {
        return reply.code(401).send({
            error: {
                message: "invalid api key",
            },
        });
    }

    const result = email_schema.safeParse(request.body);

    if (!result.success) {
        return reply.code(400).send({
            error: {
                message: "invalid email request",
                details: result.error.flatten(),
            },
        });
    }

    const { from, to, subject, html, text } = result.data;

    if (!html && !text) {
        return reply.code(400).send({
            error: {
                message: "either html or text must be provided",
            },
        });
    }

    const recipients = Array.isArray(to) ? to : [to];
    const record_id = randomUUID();
    const local_recipients = recipients.filter((address) => is_local_address(address));
    const remote_recipients = recipients.filter((address) => !is_local_address(address));

    try {
        if (local_recipients.length > 0) {
            await deliver_local(from, local_recipients, subject, html, text);
        }

        let message_id = `<${record_id}@${domain}>`;

        if (remote_recipients.length > 0) {
            const info = await deliver_remote(
                from,
                remote_recipients,
                subject,
                html,
                text,
            );
            message_id = info.messageId || message_id;
        }

        const record: SentMail = {
            id: record_id,
            message_id,
            from,
            to: recipients,
            subject,
            text: text || "",
            html: html || "",
            status: "delivered",
            error: null,
            user_id: auth.user?.id ?? null,
            created_at: new Date().toISOString(),
        };

        sent_mails.unshift(record);

        return reply.send({
            id: record.id,
            message_id,
            message: "email sent successfully",
        });
    } catch (error) {
        request.log.error(error);

        const message =
            error instanceof Error
                ? error.message.toLowerCase()
                : String(error).toLowerCase();

        sent_mails.unshift({
            id: record_id,
            message_id: "",
            from,
            to: recipients,
            subject,
            text: text || "",
            html: html || "",
            status: "failed",
            error: message,
            user_id: auth.user?.id ?? null,
            created_at: new Date().toISOString(),
        });

        return reply.code(500).send({
            error: {
                message,
            },
        });
    }
});

app.get("/v1/received", async (request, reply) => {
    if (!resolve_auth(request.headers.authorization)) {
        return reply.code(401).send({
            error: {
                message: "invalid api key",
            },
        });
    }

    const query = request.query as { q?: string };
    const messages: Array<StoredMail & { index: number }> = [];

    for (const inbox of inboxes.values()) {
        for (const message of inbox) {
            messages.push({ ...message, index: 0 });
        }
    }

    messages.sort((a, b) => b.date.localeCompare(a.date));

    let list = messages.map((message, index) => ({
        ...message,
        index: index + 1,
    }));

    if (query.q) {
        const q = query.q.toLowerCase();
        list = list.filter((message) => {
            return (
                message.subject.toLowerCase().includes(q) ||
                message.from.toLowerCase().includes(q) ||
                message.to.toLowerCase().includes(q)
            );
        });
    }

    return {
        count: list.length,
        receive: `<anything>@${domain}`,
        messages: list.map((message) => ({
            id: message.id,
            index: message.index,
            from: message.from,
            to: message.to,
            subject: message.subject,
            date: message.date,
            preview: (message.text || message.html.replace(/<[^>]+>/g, " "))
                .replace(/\s+/g, " ")
                .trim()
                .slice(0, 120),
        })),
    };
});

app.get<{ Params: { id: string } }>("/v1/received/:id", async (request, reply) => {
    if (!resolve_auth(request.headers.authorization)) {
        return reply.code(401).send({
            error: {
                message: "invalid api key",
            },
        });
    }

    for (const inbox of inboxes.values()) {
        const message = inbox.find((item) => item.id === request.params.id);
        if (message) return message;
    }

    return reply.code(404).send({
        error: {
            message: "message not found",
        },
    });
});

app.delete<{ Params: { id: string } }>("/v1/received/:id", async (request, reply) => {
    for (const [key, inbox] of inboxes.entries()) {
        const next = inbox.filter((item) => item.id !== request.params.id);
        if (next.length !== inbox.length) {
            if (next.length === 0) inboxes.delete(key);
            else inboxes.set(key, next);
            return { message: "message deleted" };
        }
    }

    return reply.code(404).send({
        error: {
            message: "message not found",
        },
    });
});

app.get<{ Params: { address: string } }>("/v1/inbox/:address", async (request, reply) => {
    const address = decodeURIComponent(request.params.address);

    if (!is_local_address(address)) {
        return reply.code(400).send({
            error: {
                message: "invalid address domain",
            },
        });
    }

    const { messages } = get_inbox(address);

    return {
        address: normalize_address(address),
        count: messages.length,
        messages: messages.map((message, index) => ({
            id: message.id,
            index: index + 1,
            from: message.from,
            subject: message.subject,
            date: message.date,
            preview: (message.text || message.html.replace(/<[^>]+>/g, " "))
                .replace(/\s+/g, " ")
                .trim()
                .slice(0, 120),
        })),
    };
});

app.get<{ Params: { address: string; id: string } }>(
    "/v1/inbox/:address/:id",
    async (request, reply) => {
        const address = decodeURIComponent(request.params.address);

        if (!is_local_address(address)) {
            return reply.code(400).send({
                error: {
                    message: "invalid address domain",
                },
            });
        }

        const { messages } = get_inbox(address);
        const message = messages.find((item) => item.id === request.params.id);

        if (!message) {
            return reply.code(404).send({
                error: {
                    message: "message not found",
                },
            });
        }

        return message;
    },
);

app.delete<{ Params: { address: string } }>("/v1/inbox/:address", async (request, reply) => {
    const address = decodeURIComponent(request.params.address);

    if (!is_local_address(address)) {
        return reply.code(400).send({
            error: {
                message: "invalid address domain",
            },
        });
    }

    const { key } = get_inbox(address);
    inboxes.delete(key);

    return {
        message: "inbox cleared",
    };
});

const client_root = path.join(process.cwd(), "client", "dist");

if (fs.existsSync(client_root)) {
    await app.register(fastifyStatic, {
        root: client_root,
        wildcard: false,
    });
}

app.setNotFoundHandler((request, reply) => {
    if (
        request.method === "GET" &&
        !request.url.startsWith("/v1/") &&
        fs.existsSync(path.join(client_root, "index.html"))
    ) {
        return reply.sendFile("index.html");
    }

    return reply.code(404).send({
        error: {
            message: "not found",
        },
    });
});

try {
    await smtp_server.listen({
        host: smtp_listen_host,
        port: smtp_port,
    });

    await app.listen({
        port,
        host: api_listen_host,
    });

    console.log(`shittymail is running on http://localhost:${port}`);
    console.log(`smtp server is running on port ${smtp_port}`);
} catch (error) {
    app.log.error(error);
    process.exit(1);
}
