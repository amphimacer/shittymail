import fastify from "fastify";
import nodemailer from "nodemailer";
import { SMTPServer } from "smtp-server";
import { z } from "zod";
import dotenv from "dotenv";

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

const transporter = nodemailer.createTransport({
  host: smtp_host,
  port: smtp_port,
  secure: false,
  ignoreTLS: true,
  auth: {
    user: smtp_user,
    pass: smtp_password,
  },
});

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

const smtp_server = new SMTPServer({
  secure: false,
  authOptional: false,
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

  onRcptTo(_address, _session, callback) {
    callback();
  },

  onData(stream, _session, callback) {
    let data = "";

    stream.setEncoding("utf8");

    stream.on("data", (chunk: string) => {
      data += chunk;
    });

    stream.on("end", () => {
      console.log("received email:");
      console.log(data);
      callback();
    });

    stream.on("error", callback);
  },
});

app.get("/", async () => {
  return {
    message: "shittymail is running!",
  };
});

app.get("/health", async () => {
  return {
    status: "ok",
  };
});

app.post("/v1/emails", async (request, reply) => {
  const authorization = request.headers.authorization;

  if (!authorization) {
    return reply.code(401).send({
      error: {
        message: "missing authorization header",
      },
    });
  }

  const [scheme, token] = authorization.split(" ");

  if (scheme.toLowerCase() !== "bearer" || token !== api_key) {
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

  try {
    const info = await transporter.sendMail({
      from,
      to,
      subject,
      html,
      text,
    });

    return reply.send({
      id: info.messageId,
      message: "email sent successfully",
    });
  } catch (error) {
    request.log.error(error);

    return reply.code(500).send({
      error: {
        message:
          error instanceof Error
            ? error.message.toLowerCase()
            : String(error).toLowerCase(),
      },
    });
  }
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
