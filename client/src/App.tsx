import { useCallback, useEffect, useMemo, useState } from "react";
import {
    createUser,
    deleteUser,
    fetchDomain,
    fetchReceived,
    fetchReceivedOne,
    fetchSent,
    fetchSentOne,
    fetchUsers,
    getApiKey,
    sendEmail,
    setApiKey,
    type ReceivedEmail,
    type SentEmail,
    type User,
} from "./api";

type Tab = "sending" | "receiving";
type Modal = "api" | "users" | "compose" | "detail" | null;

function relativeTime(iso: string) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "—";
    const diff = Date.now() - date.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 48) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
}

function withinRange(iso: string, range: string) {
    if (range === "all") return true;
    return Date.now() - new Date(iso).getTime() <= Number(range) * 86400000;
}

export default function App() {
    const [domain, setDomain] = useState("anomalyon.top");
    const [receiveLabel, setReceiveLabel] = useState("<anything>@anomalyon.top");
    const [tab, setTab] = useState<Tab>("sending");
    const [search, setSearch] = useState("");
    const [range, setRange] = useState("15");
    const [status, setStatus] = useState("all");
    const [sent, setSent] = useState<SentEmail[]>([]);
    const [received, setReceived] = useState<ReceivedEmail[]>([]);
    const [users, setUsers] = useState<User[]>([]);
    const [modal, setModal] = useState<Modal>(null);
    const [toast, setToast] = useState("");
    const [apiKeyInput, setApiKeyInput] = useState(getApiKey());
    const [userName, setUserName] = useState("");
    const [compose, setCompose] = useState({
        from: "",
        to: "",
        subject: "",
        body: "",
    });
    const [detail, setDetail] = useState<{
        title: string;
        meta: Array<[string, string]>;
        html: string;
        text: string;
    } | null>(null);
    const [hasKey, setHasKey] = useState(() => Boolean(getApiKey()));

    const showToast = useCallback((message: string) => {
        setToast(message);
        window.setTimeout(() => setToast(""), 1800);
    }, []);

    const load = useCallback(async () => {
        if (!getApiKey()) {
            setSent([]);
            setReceived([]);
            return;
        }
        try {
            if (tab === "sending") {
                const data = await fetchSent({
                    q: search.trim() || undefined,
                    status,
                });
                setSent(data.emails);
            } else {
                const data = await fetchReceived({
                    q: search.trim() || undefined,
                });
                setReceived(data.messages);
                if (data.receive) setReceiveLabel(data.receive);
            }
        } catch (error) {
            setSent([]);
            setReceived([]);
            showToast(error instanceof Error ? error.message : "failed to load emails");
        }
    }, [tab, search, status, showToast]);

    useEffect(() => {
        if (!hasKey) {
            setModal("api");
            setSent([]);
            setReceived([]);
            return;
        }
        fetchDomain()
            .then((data) => {
                setDomain(data.domain);
                setReceiveLabel(data.receive);
                setCompose((prev) => ({
                    ...prev,
                    from: prev.from || `noreply@${data.domain}`,
                }));
            })
            .catch(() => undefined);
    }, [hasKey]);

    useEffect(() => {
        if (!hasKey) return;
        const timer = window.setTimeout(load, 150);
        return () => window.clearTimeout(timer);
    }, [load, hasKey]);

    useEffect(() => {
        if (!hasKey) return;
        const id = window.setInterval(() => {
            if (document.visibilityState === "visible") load();
        }, 5000);
        return () => window.clearInterval(id);
    }, [load, hasKey]);

    const filteredSent = useMemo(
        () => sent.filter((mail) => withinRange(mail.created_at, range)),
        [sent, range],
    );

    const filteredReceived = useMemo(
        () => received.filter((mail) => withinRange(mail.date, range)),
        [received, range],
    );

    async function openUsers() {
        setModal("users");
        if (!getApiKey()) {
            showToast("set your API key first");
            setModal("api");
            return;
        }
        try {
            const data = await fetchUsers();
            setUsers(data.users);
        } catch (error) {
            showToast(error instanceof Error ? error.message : "unauthorized");
        }
    }

    async function handleCreateUser() {
        const name = userName.trim();
        if (!name) return showToast("name required");
        if (!getApiKey()) {
            setModal("api");
            return showToast("set your API key first");
        }
        try {
            const user = await createUser(name);
            setUserName("");
            showToast(`created ${user.name}`);
            const data = await fetchUsers();
            setUsers(data.users);
        } catch (error) {
            showToast(error instanceof Error ? error.message : "create failed");
        }
    }

    async function handleDeleteUser(id: string) {
        try {
            await deleteUser(id);
            showToast("user deleted");
            const data = await fetchUsers();
            setUsers(data.users);
        } catch (error) {
            showToast(error instanceof Error ? error.message : "delete failed");
        }
    }

    async function handleSend() {
        if (!getApiKey()) {
            setModal("api");
            return showToast("set your API key first");
        }
        const { from, to, subject, body } = compose;
        if (!from || !to || !subject || !body) return showToast("fill all fields");
        const payload: {
            from: string;
            to: string;
            subject: string;
            html?: string;
            text?: string;
        } = { from, to, subject };
        if (/<[^>]+>/.test(body)) payload.html = body;
        else payload.text = body;
        try {
            await sendEmail(payload);
            setModal(null);
            showToast("email sent");
            setTab("sending");
            await load();
        } catch (error) {
            showToast(error instanceof Error ? error.message : "send failed");
        }
    }

    async function openSent(id: string) {
        try {
            const mail = await fetchSentOne(id);
            setDetail({
                title: mail.subject,
                meta: [
                    ["To", mail.to.join(", ")],
                    ["From", mail.from],
                    ["Status", mail.status],
                    ["Sent", new Date(mail.created_at).toLocaleString()],
                ],
                html: mail.html,
                text: mail.text || mail.error || "(empty)",
            });
            setModal("detail");
        } catch {
            showToast("email not found");
        }
    }

    async function openReceived(id: string) {
        try {
            const mail = await fetchReceivedOne(id);
            setDetail({
                title: mail.subject,
                meta: [
                    ["From", mail.from],
                    ["To", mail.to],
                    ["Received", new Date(mail.date).toLocaleString()],
                ],
                html: mail.html,
                text: mail.text || "(empty)",
            });
            setModal("detail");
        } catch {
            showToast("message not found");
        }
    }

    function exportCurrent() {
        const payload = tab === "sending" ? { emails: sent } : { messages: received };
        const blob = new Blob([JSON.stringify(payload, null, 2)], {
            type: "application/json",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${tab}-${domain}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showToast("exported");
    }

    return (
        <>
            <div className="app">
                <div className="top">
                    <div>
                        <h1>Emails</h1>
                        <div className="tabs">
                            <button
                                type="button"
                                className={tab === "sending" ? "active" : ""}
                                onClick={() => setTab("sending")}
                            >
                                Sending
                            </button>
                            <button
                                type="button"
                                className={tab === "receiving" ? "active" : ""}
                                onClick={() => setTab("receiving")}
                            >
                                Receiving
                            </button>
                        </div>
                    </div>
                    <div className="top-actions">
                        <button className="ghost-btn" type="button" onClick={openUsers}>
                            <i className="ri-user-add-line" />
                            Users
                        </button>
                        {tab === "sending" && (
                            <button
                                className="ghost-btn"
                                type="button"
                                onClick={() => setModal("compose")}
                            >
                                <i className="ri-send-plane-line" />
                                Send email
                            </button>
                        )}
                        <button
                            className="icon-square"
                            type="button"
                            title="API key"
                            onClick={() => {
                                setApiKeyInput(getApiKey());
                                setModal("api");
                            }}
                        >
                            <i className="ri-code-s-slash-line" />
                        </button>
                    </div>
                </div>

                <div className="toolbar">
                    <div className="search">
                        <i className="ri-search-line" />
                        <input
                            type="search"
                            placeholder="Search..."
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                        />
                    </div>
                    <select value={range} onChange={(event) => setRange(event.target.value)}>
                        <option value="15">Last 15 days</option>
                        <option value="7">Last 7 days</option>
                        <option value="30">Last 30 days</option>
                        <option value="all">All time</option>
                    </select>
                    {tab === "sending" && (
                        <select
                            value={status}
                            onChange={(event) => setStatus(event.target.value)}
                        >
                            <option value="all">All Statuses</option>
                            <option value="delivered">Delivered</option>
                            <option value="failed">Failed</option>
                        </select>
                    )}
                    <button
                        className="icon-square"
                        type="button"
                        title="Export"
                        onClick={exportCurrent}
                    >
                        <i className="ri-download-2-line" />
                    </button>
                </div>

                {!hasKey ? (
                    <section className="panel">
                        <div className="empty show">
                            <div className="empty-icon">
                                <i className="ri-key-2-line" />
                            </div>
                            <h2>API key required</h2>
                            <p>Save your master API key to view and send emails.</p>
                            <button
                                className="primary-btn"
                                type="button"
                                onClick={() => {
                                    setApiKeyInput(getApiKey());
                                    setModal("api");
                                }}
                            >
                                Enter API key
                                <i className="ri-arrow-right-up-line" />
                            </button>
                        </div>
                    </section>
                ) : tab === "sending" ? (
                    <section className="panel">
                        {filteredSent.length > 0 && (
                            <div className="table-head">
                                <span>To</span>
                                <span>Status</span>
                                <span>Subject</span>
                                <span>Sent</span>
                                <span />
                            </div>
                        )}
                        <div>
                            {filteredSent.map((mail) => (
                                <div
                                    key={mail.id}
                                    className="table-row"
                                    onClick={() => openSent(mail.id)}
                                >
                                    <div className="to-cell">
                                        <div className="mail-badge">
                                            <i className="ri-mail-line" />
                                        </div>
                                        <span>{mail.to.join(", ")}</span>
                                    </div>
                                    <div>
                                        <span className={`status ${mail.status}`}>
                                            {mail.status === "delivered"
                                                ? "Delivered"
                                                : "Failed"}
                                        </span>
                                    </div>
                                    <div className="subject-cell">{mail.subject}</div>
                                    <div className="time-cell">
                                        {relativeTime(mail.created_at)}
                                    </div>
                                    <button className="icon-square" type="button">
                                        <i className="ri-more-fill" />
                                    </button>
                                </div>
                            ))}
                        </div>
                        <div className={`empty ${filteredSent.length === 0 ? "show" : ""}`}>
                            <div className="empty-icon">
                                <i className="ri-mail-send-line" />
                            </div>
                            <h2>No emails sent yet</h2>
                            <p>Send your first email with the API or the compose button.</p>
                            <button
                                className="primary-btn"
                                type="button"
                                onClick={() => setModal("compose")}
                            >
                                Send email
                                <i className="ri-arrow-right-up-line" />
                            </button>
                        </div>
                    </section>
                ) : (
                    <section className="panel">
                        {filteredReceived.length > 0 && (
                            <div className="recv-head">
                                <span>From</span>
                                <span>To</span>
                                <span>Subject</span>
                                <span>Received</span>
                                <span />
                            </div>
                        )}
                        <div>
                            {filteredReceived.map((mail) => (
                                <div
                                    key={mail.id}
                                    className="recv-row"
                                    onClick={() => openReceived(mail.id)}
                                >
                                    <div className="to-cell">
                                        <div className="mail-badge">
                                            <i className="ri-mail-line" />
                                        </div>
                                        <span>{mail.from}</span>
                                    </div>
                                    <div className="subject-cell">{mail.to}</div>
                                    <div className="subject-cell">{mail.subject}</div>
                                    <div className="time-cell">{relativeTime(mail.date)}</div>
                                    <button className="icon-square" type="button">
                                        <i className="ri-more-fill" />
                                    </button>
                                </div>
                            ))}
                        </div>
                        <div
                            className={`empty ${filteredReceived.length === 0 ? "show" : ""}`}
                        >
                            <div className="empty-icon">
                                <i className="ri-inbox-2-line" />
                            </div>
                            <h2>No received emails yet</h2>
                            <p>Start receiving emails with a predefined address</p>
                            <div className="receive-chip">
                                <span>{receiveLabel}</span>
                                <button
                                    type="button"
                                    title="Copy"
                                    onClick={async () => {
                                        try {
                                            await navigator.clipboard.writeText(
                                                `anything@${domain}`,
                                            );
                                            showToast("copied");
                                        } catch {
                                            showToast("copy failed");
                                        }
                                    }}
                                >
                                    <i className="ri-file-copy-line" />
                                </button>
                            </div>
                            <p className="hint">or send to any address on your domain</p>
                            <a
                                className="primary-btn"
                                href="/health"
                                target="_blank"
                                rel="noreferrer"
                            >
                                Go to docs
                                <i className="ri-arrow-right-up-line" />
                            </a>
                        </div>
                    </section>
                )}
            </div>

            {modal === "api" && (
                <div
                    className="modal-backdrop open"
                    onClick={() => {
                        if (hasKey) setModal(null);
                    }}
                >
                    <div className="modal" onClick={(event) => event.stopPropagation()}>
                        <h3>API key</h3>
                        <p className="sub">
                            Master key from your .env — used to create users and send mail.
                        </p>
                        <div className="field">
                            <label htmlFor="api-key-input">Bearer token</label>
                            <input
                                id="api-key-input"
                                type="password"
                                placeholder="re_..."
                                value={apiKeyInput}
                                onChange={(event) => setApiKeyInput(event.target.value)}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter") {
                                        const value = apiKeyInput.trim();
                                        if (!value) return showToast("api key required");
                                        setApiKey(value);
                                        setHasKey(true);
                                        setModal(null);
                                        showToast("api key saved");
                                    }
                                }}
                            />
                        </div>
                        <div className="modal-actions">
                            {hasKey && (
                                <button
                                    className="ghost-btn"
                                    type="button"
                                    onClick={() => setModal(null)}
                                >
                                    Cancel
                                </button>
                            )}
                            <button
                                className="primary-btn"
                                type="button"
                                onClick={() => {
                                    const value = apiKeyInput.trim();
                                    if (!value) return showToast("api key required");
                                    setApiKey(value);
                                    setHasKey(true);
                                    setModal(null);
                                    showToast("api key saved");
                                }}
                            >
                                Save
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {modal === "users" && (
                <div className="modal-backdrop open" onClick={() => setModal(null)}>
                    <div
                        className="modal wide"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <h3>Users</h3>
                        <p className="sub">
                            Create as many API users as you want. Each gets their own key.
                        </p>
                        <div className="field">
                            <label htmlFor="user-name">Name</label>
                            <input
                                id="user-name"
                                type="text"
                                placeholder="anomaly-app"
                                value={userName}
                                onChange={(event) => setUserName(event.target.value)}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter") handleCreateUser();
                                }}
                            />
                        </div>
                        <div
                            className="modal-actions"
                            style={{ justifyContent: "flex-start", marginBottom: 8 }}
                        >
                            <button
                                className="primary-btn"
                                type="button"
                                onClick={handleCreateUser}
                            >
                                Create user
                                <i className="ri-user-add-line" />
                            </button>
                        </div>
                        <div className="users-list">
                            {users.length === 0 ? (
                                <p className="sub">No users yet — create one above.</p>
                            ) : (
                                users.map((user) => (
                                    <div className="user-row" key={user.id}>
                                        <div>
                                            <strong>{user.name}</strong>
                                            <code>{user.api_key}</code>
                                        </div>
                                        <button
                                            className="ghost-btn"
                                            type="button"
                                            onClick={() => handleDeleteUser(user.id)}
                                        >
                                            Delete
                                        </button>
                                    </div>
                                ))
                            )}
                        </div>
                        <div className="modal-actions">
                            <button
                                className="ghost-btn"
                                type="button"
                                onClick={() => setModal(null)}
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {modal === "compose" && (
                <div className="modal-backdrop open" onClick={() => setModal(null)}>
                    <div
                        className="modal wide"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <h3>Send email</h3>
                        <p className="sub">Uses your saved API key against POST /v1/emails.</p>
                        <div className="field">
                            <label htmlFor="compose-from">From</label>
                            <input
                                id="compose-from"
                                type="email"
                                placeholder={`noreply@${domain}`}
                                value={compose.from}
                                onChange={(event) =>
                                    setCompose((prev) => ({
                                        ...prev,
                                        from: event.target.value,
                                    }))
                                }
                            />
                        </div>
                        <div className="field">
                            <label htmlFor="compose-to">To</label>
                            <input
                                id="compose-to"
                                type="email"
                                placeholder="you@gmail.com"
                                value={compose.to}
                                onChange={(event) =>
                                    setCompose((prev) => ({
                                        ...prev,
                                        to: event.target.value,
                                    }))
                                }
                            />
                        </div>
                        <div className="field">
                            <label htmlFor="compose-subject">Subject</label>
                            <input
                                id="compose-subject"
                                type="text"
                                placeholder="Hello"
                                value={compose.subject}
                                onChange={(event) =>
                                    setCompose((prev) => ({
                                        ...prev,
                                        subject: event.target.value,
                                    }))
                                }
                            />
                        </div>
                        <div className="field">
                            <label htmlFor="compose-body">HTML / text</label>
                            <textarea
                                id="compose-body"
                                placeholder="<h1>Hello</h1>"
                                value={compose.body}
                                onChange={(event) =>
                                    setCompose((prev) => ({
                                        ...prev,
                                        body: event.target.value,
                                    }))
                                }
                            />
                        </div>
                        <div className="modal-actions">
                            <button
                                className="ghost-btn"
                                type="button"
                                onClick={() => setModal(null)}
                            >
                                Cancel
                            </button>
                            <button
                                className="primary-btn"
                                type="button"
                                onClick={handleSend}
                            >
                                Send
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {modal === "detail" && detail && (
                <div className="modal-backdrop open" onClick={() => setModal(null)}>
                    <div
                        className="modal wide"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <h3>{detail.title}</h3>
                        <div className="viewer-meta">
                            {detail.meta.map(([label, value]) => (
                                <div key={label}>
                                    {label} <strong>{value}</strong>
                                </div>
                            ))}
                        </div>
                        <div className="viewer-body">
                            {detail.html ? (
                                <iframe sandbox="" srcDoc={detail.html} title="email" />
                            ) : (
                                <pre>{detail.text}</pre>
                            )}
                        </div>
                        <div className="modal-actions">
                            <button
                                className="ghost-btn"
                                type="button"
                                onClick={() => setModal(null)}
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div className={`toast ${toast ? "show" : ""}`}>{toast}</div>
        </>
    );
}
