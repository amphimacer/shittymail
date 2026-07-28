const KEY_STORAGE = "shittymail.api_key";

export type SentEmail = {
    id: string;
    to: string[];
    from: string;
    subject: string;
    status: "delivered" | "failed";
    created_at: string;
    user_id: string | null;
};

export type ReceivedEmail = {
    id: string;
    index: number;
    from: string;
    to: string;
    subject: string;
    date: string;
    preview: string;
};

export type User = {
    id: string;
    name: string;
    api_key: string;
    created_at: string;
};

export function getApiKey() {
    return localStorage.getItem(KEY_STORAGE) || "";
}

export function setApiKey(value: string) {
    localStorage.setItem(KEY_STORAGE, value.trim());
}

function authHeaders(): Record<string, string> {
    const key = getApiKey();
    const headers: Record<string, string> = {
        "Content-Type": "application/json",
    };
    if (key) headers.Authorization = `Bearer ${key}`;
    return headers;
}

async function parse<T>(res: Response): Promise<T> {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const message =
            (data as { error?: { message?: string } })?.error?.message ||
            "request failed";
        throw new Error(message);
    }
    return data as T;
}

export async function fetchDomain() {
    return parse<{ domain: string; receive: string }>(await fetch("/v1/domain"));
}

export async function fetchSent(params: { q?: string; status?: string }) {
    const query = new URLSearchParams();
    if (params.status && params.status !== "all") query.set("status", params.status);
    if (params.q) query.set("q", params.q);
    return parse<{ emails: SentEmail[] }>(
        await fetch(`/v1/emails?${query}`, { headers: authHeaders() }),
    );
}

export async function fetchSentOne(id: string) {
    return parse<{
        id: string;
        to: string[];
        from: string;
        subject: string;
        status: string;
        text: string;
        html: string;
        error: string | null;
        created_at: string;
    }>(await fetch(`/v1/emails/${id}`, { headers: authHeaders() }));
}

export async function fetchReceived(params: { q?: string }) {
    const query = new URLSearchParams();
    if (params.q) query.set("q", params.q);
    return parse<{ messages: ReceivedEmail[]; receive: string }>(
        await fetch(`/v1/received?${query}`, { headers: authHeaders() }),
    );
}

export async function fetchReceivedOne(id: string) {
    return parse<{
        id: string;
        from: string;
        to: string;
        subject: string;
        text: string;
        html: string;
        date: string;
    }>(await fetch(`/v1/received/${id}`, { headers: authHeaders() }));
}

export async function fetchUsers() {
    return parse<{ users: User[] }>(
        await fetch("/v1/users", { headers: authHeaders() }),
    );
}

export async function createUser(name: string) {
    return parse<User>(
        await fetch("/v1/users", {
            method: "POST",
            headers: authHeaders(),
            body: JSON.stringify({ name }),
        }),
    );
}

export async function deleteUser(id: string) {
    return parse<{ message: string }>(
        await fetch(`/v1/users/${id}`, {
            method: "DELETE",
            headers: authHeaders(),
        }),
    );
}

export async function sendEmail(payload: {
    from: string;
    to: string;
    subject: string;
    html?: string;
    text?: string;
}) {
    return parse<{ id: string; message: string }>(
        await fetch("/v1/emails", {
            method: "POST",
            headers: authHeaders(),
            body: JSON.stringify(payload),
        }),
    );
}
