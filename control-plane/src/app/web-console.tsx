"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { Locale, MessageKey, Messages } from "@/i18n/load-messages";

interface Capabilities {
  readonly personAuth: boolean;
  readonly deviceEnrollment: boolean;
  readonly delivery: boolean;
}

interface DeviceSummary {
  readonly device_id: string;
  readonly enrollment_state: string;
  readonly availability: string;
  readonly has_approved_drive: boolean;
  readonly platform: string;
  readonly agent_version: string;
  readonly created_at: string;
}

interface ConnectedPersonConsent {
  readonly person_id: string;
  readonly display_name: string;
  readonly grant_active: boolean;
  readonly account_available: boolean;
}

interface ConsentSnapshot {
  readonly paused: boolean;
  readonly connected_people: readonly ConnectedPersonConsent[];
}

interface WebConsoleProps {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly capabilities: Capabilities;
}

const errorKeys: Readonly<Record<string, MessageKey>> = {
  PERSON_AUTH_DISABLED: "error.PERSON_AUTH_DISABLED",
  ENROLLMENT_DISABLED: "error.ENROLLMENT_DISABLED",
  AUTHENTICATION_REQUIRED: "error.AUTHENTICATION_REQUIRED",
  AUTHENTICATION_FAILED: "error.AUTHENTICATION_FAILED",
  ACCOUNT_RESTRICTED: "error.ACCOUNT_RESTRICTED",
  ACCOUNT_UNAVAILABLE: "error.ACCOUNT_UNAVAILABLE",
  DEVICE_ALREADY_REGISTERED: "error.DEVICE_ALREADY_REGISTERED",
  CONNECTION_REQUIRED: "error.CONNECTION_REQUIRED",
  INVITATION_UNAVAILABLE: "error.INVITATION_UNAVAILABLE",
  ORIGIN_NOT_ALLOWED: "error.ORIGIN_NOT_ALLOWED",
  INVALID_REQUEST: "error.INVALID_REQUEST",
  SERVICE_UNAVAILABLE: "error.SERVICE_UNAVAILABLE",
};

const semanticKeys: Readonly<Record<string, MessageKey>> = {
  SETUP_IN_PROGRESS: "device.state.SETUP_IN_PROGRESS",
  READY: "device.state.READY",
  REVOKED: "device.state.REVOKED",
  AVAILABLE: "device.availability.AVAILABLE",
  PAUSED: "device.availability.PAUSED",
  OFFLINE: "device.availability.OFFLINE",
  WINDOWS: "device.platform.WINDOWS",
};

export function WebConsole({
  locale,
  messages,
  capabilities,
}: WebConsoleProps) {
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [linkRequested, setLinkRequested] = useState(false);
  const [authenticated, setAuthenticated] = useState<boolean | null>(
    capabilities.personAuth ? null : false,
  );
  const [devices, setDevices] = useState<readonly DeviceSummary[]>([]);
  const [consent, setConsent] = useState<ConsentSnapshot | null>(null);
  const [enrollment, setEnrollment] = useState<{
    readonly secret: string;
    readonly expiresAt: string;
  } | null>(null);
  const [relationshipInvitation, setRelationshipInvitation] = useState<{
    readonly code: string;
    readonly expiresAt: string;
  } | null>(null);
  const [invitationCode, setInvitationCode] = useState("");
  const [working, setWorking] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const t = useCallback((key: MessageKey) => messages[key], [messages]);

  const loadConsent = useCallback(async () => {
    const response = await fetch("/api/person/v1/consent", {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!response.ok) {
      setConsent(null);
      return;
    }
    const body = (await response.json()) as ConsentSnapshot;
    setConsent(body);
  }, []);

  const loadDevices = useCallback(async () => {
    if (!capabilities.personAuth) {
      setAuthenticated(false);
      return;
    }
    try {
      const response = await fetch("/api/person/v1/device-enrollments", {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (response.status === 401) {
        setAuthenticated(false);
        setDevices([]);
        setConsent(null);
        return;
      }
      if (!response.ok) {
        setAuthenticated(null);
        setConsent(null);
        return;
      }
      const body = (await response.json()) as { devices?: DeviceSummary[] };
      setAuthenticated(true);
      setDevices(Array.isArray(body.devices) ? body.devices : []);
      await loadConsent();
    } catch {
      setAuthenticated(null);
      setConsent(null);
    }
  }, [capabilities.personAuth, loadConsent]);

  useEffect(() => {
    if (!capabilities.personAuth) return;
    const controller = new AbortController();
    void fetch("/api/person/v1/device-enrollments", {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 401) {
          setAuthenticated(false);
          setDevices([]);
          setConsent(null);
          return;
        }
        if (!response.ok) {
          setAuthenticated(null);
          setConsent(null);
          return;
        }
        const body = (await response.json()) as { devices?: DeviceSummary[] };
        setAuthenticated(true);
        setDevices(Array.isArray(body.devices) ? body.devices : []);
        const consentResponse = await fetch("/api/person/v1/consent", {
          cache: "no-store",
          credentials: "same-origin",
          signal: controller.signal,
        });
        if (consentResponse.ok) {
          setConsent((await consentResponse.json()) as ConsentSnapshot);
        } else {
          setConsent(null);
        }
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setAuthenticated(null);
          setConsent(null);
        }
      });
    return () => controller.abort();
  }, [capabilities.personAuth]);

  function localizedError(code: string | null): string {
    const key = code === null ? undefined : errorKeys[code];
    return t(key ?? "error.UNKNOWN");
  }

  function semanticLabel(value: string): string {
    const key = semanticKeys[value];
    return t(key ?? "status.unknown");
  }

  async function submit(
    path: string,
    body: Readonly<Record<string, unknown>>,
  ): Promise<Response | null> {
    setWorking(true);
    setFeedback(t("feedback.working"));
    try {
      const response = await fetch(path, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const value = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        setFeedback(localizedError(value?.error ?? null));
        return null;
      }
      return response;
    } catch {
      setFeedback(t("error.SERVICE_UNAVAILABLE"));
      return null;
    } finally {
      setWorking(false);
    }
  }

  async function beginAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const response = await submit("/api/person/v1/auth/magic-link", { email });
    if (response !== null) {
      setLinkRequested(true);
      setFeedback(t("identity.linkSent"));
    }
  }

  async function verifyOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const response = await submit("/api/person/v1/auth/verify-otp", {
      email,
      token: otp,
    });
    if (response !== null) {
      setOtp("");
      await loadDevices();
      setFeedback(t("identity.authenticated"));
    }
  }

  async function logout() {
    const response = await submit("/api/person/v1/auth/logout", {});
    if (response !== null) {
      setAuthenticated(false);
      setDevices([]);
      setConsent(null);
      setEnrollment(null);
      setRelationshipInvitation(null);
      setInvitationCode("");
      setFeedback(t("feedback.signedOut"));
    }
  }

  async function createEnrollment() {
    const response = await submit("/api/person/v1/device-enrollments", {});
    if (response === null) return;
    const value = (await response.json()) as {
      enrollment_secret: string;
      expires_at: string;
    };
    setEnrollment({
      secret: value.enrollment_secret,
      expiresAt: value.expires_at,
    });
    setFeedback(t("feedback.enrollmentCreated"));
  }

  async function revokeDevice(deviceId: string) {
    const response = await submit("/api/person/v1/device-revocations", {
      device_id: deviceId,
    });
    if (response !== null) {
      setEnrollment(null);
      setFeedback(t("feedback.deviceRevoked"));
      await loadDevices();
    }
  }

  async function setPaused(paused: boolean) {
    const response = await submit("/api/person/v1/consent", { paused });
    if (response !== null) {
      await loadConsent();
      setFeedback(
        t(paused ? "feedback.consentPaused" : "feedback.consentResumed"),
      );
    }
  }

  async function setGrant(personId: string, granted: boolean) {
    const response = await submit("/api/person/v1/consent-grants", {
      person_id: personId,
      granted,
    });
    if (response !== null) {
      await loadConsent();
      setFeedback(
        t(granted ? "feedback.grantCreated" : "feedback.grantRevoked"),
      );
    }
  }

  async function createRelationshipInvitation() {
    const response = await submit(
      "/api/person/v1/relationship-invitations",
      {},
    );
    if (response === null) return;
    const value = (await response.json()) as {
      invitation_code: string;
      expires_at: string;
    };
    setRelationshipInvitation({
      code: value.invitation_code,
      expiresAt: value.expires_at,
    });
    setFeedback(t("feedback.relationshipInvitationCreated"));
  }

  async function acceptRelationshipInvitation(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    const response = await submit("/api/person/v1/relationships", {
      invitation_code: invitationCode,
    });
    if (response !== null) {
      setInvitationCode("");
      await loadConsent();
      setFeedback(t("feedback.relationshipConnected"));
    }
  }

  async function disconnectRelationship(personId: string) {
    const response = await submit(
      "/api/person/v1/relationship-disconnections",
      { person_id: personId },
    );
    if (response !== null) {
      await loadConsent();
      setFeedback(t("feedback.relationshipDisconnected"));
    }
  }

  function switchLocale() {
    const next = locale === "en" ? "ja" : "en";
    document.cookie = `eject_locale=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
    window.location.reload();
  }

  return (
    <main className="site-shell" lang={locale}>
      <header className="masthead">
        <a className="wordmark" href="#service" aria-label={t("nav.homeLabel")}>
          <span aria-hidden="true">⏏</span> EJECT
        </a>
        <nav aria-label={t("nav.ariaLabel")}>
          <a href="#service">{t("nav.service")}</a>
          <a href="#identity">{t("nav.identity")}</a>
          <a href="#device">{t("nav.device")}</a>
          <a href="#consent">{t("nav.consent")}</a>
        </nav>
        <button className="language" type="button" onClick={switchLocale}>
          {t("nav.language")}
        </button>
      </header>

      <section className="hero" id="service" aria-labelledby="headline">
        <div className="hero-copy">
          <p className="eyebrow">{t("home.eyebrow")}</p>
          <h1 id="headline">{t("home.headline")}</h1>
          <p className="statement">{t("home.statement")}</p>
          <div className="preview-note">
            <span>{t("hero.previewBadge")}</span>
            <p>{t("hero.previewNotice")}</p>
          </div>
        </div>
        <div className="eject-station">
          <button
            className="eject-button"
            type="button"
            disabled
            aria-describedby="eject-unavailable"
          >
            <span className="eject-symbol" aria-label={t("hero.symbolLabel")}>
              ⏏
            </span>
            <span>{t("hero.action")}</span>
          </button>
          <p id="eject-unavailable">{t("hero.actionUnavailable")}</p>
        </div>
      </section>

      <section className="capability-strip" aria-label={t("home.statusLabel")}>
        <Capability
          label={t("status.auth")}
          enabled={capabilities.personAuth}
          messages={messages}
        />
        <Capability
          label={t("status.enrollment")}
          enabled={capabilities.deviceEnrollment}
          messages={messages}
        />
        <Capability
          label={t("status.delivery")}
          enabled={capabilities.delivery}
          messages={messages}
        />
      </section>

      <section className="service-grid">
        <article className="service-card" id="identity">
          <SectionHeading
            number={t("section.identityNumber")}
            title={t("section.identityTitle")}
          />
          <p>{t("identity.description")}</p>
          <p className="state-line">
            {authenticated === null
              ? t("identity.checking")
              : authenticated
                ? t("identity.authenticated")
                : t("identity.anonymous")}
          </p>
          {!capabilities.personAuth ? (
            <p className="bounded-notice">{t("identity.disabled")}</p>
          ) : authenticated ? (
            <button
              className="secondary-action"
              type="button"
              disabled={working}
              onClick={() => void logout()}
            >
              {t("identity.logout")}
            </button>
          ) : (
            <>
              <form onSubmit={(event) => void beginAuth(event)}>
                <label htmlFor="email">{t("identity.emailLabel")}</label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  maxLength={254}
                  placeholder={t("identity.emailPlaceholder")}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
                <button type="submit" disabled={working}>
                  {t("identity.sendLink")}
                </button>
              </form>
              {linkRequested ? (
                <form onSubmit={(event) => void verifyOtp(event)}>
                  <label htmlFor="otp">{t("identity.otpLabel")}</label>
                  <input
                    id="otp"
                    name="otp"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    required
                    minLength={6}
                    maxLength={10}
                    pattern="[0-9]{6,10}"
                    placeholder={t("identity.otpPlaceholder")}
                    value={otp}
                    onChange={(event) => setOtp(event.target.value)}
                  />
                  <button type="submit" disabled={working}>
                    {t("identity.verifyOtp")}
                  </button>
                </form>
              ) : null}
            </>
          )}
        </article>

        <article className="service-card" id="device">
          <SectionHeading
            number={t("section.deviceNumber")}
            title={t("section.deviceTitle")}
          />
          <p>{t("device.description")}</p>
          {authenticated === null ? (
            <p className="state-line">{t("device.loading")}</p>
          ) : null}
          {devices.length === 0 && authenticated !== null ? (
            <p className="state-line">{t("device.none")}</p>
          ) : (
            <div className="device-list">
              {devices.map((device) => (
                <div className="device-record" key={device.device_id}>
                  <dl>
                    <div>
                      <dt>{t("device.state")}</dt>
                      <dd>{semanticLabel(device.enrollment_state)}</dd>
                    </div>
                    <div>
                      <dt>{t("device.availability")}</dt>
                      <dd>{semanticLabel(device.availability)}</dd>
                    </div>
                    <div>
                      <dt>{t("device.platform")}</dt>
                      <dd>{semanticLabel(device.platform)}</dd>
                    </div>
                    <div>
                      <dt>{t("device.agentVersion")}</dt>
                      <dd>{device.agent_version}</dd>
                    </div>
                  </dl>
                  {device.enrollment_state !== "REVOKED" ? (
                    <button
                      className="danger-action"
                      type="button"
                      disabled={working}
                      onClick={() => void revokeDevice(device.device_id)}
                    >
                      {t("device.revoke")}
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          )}
          {authenticated && capabilities.deviceEnrollment ? (
            <button
              type="button"
              disabled={
                working ||
                devices.some((device) => device.enrollment_state !== "REVOKED")
              }
              onClick={() => void createEnrollment()}
            >
              {t("device.createEnrollment")}
            </button>
          ) : (
            <p className="bounded-notice">{t("device.enrollmentDisabled")}</p>
          )}
          {enrollment !== null ? (
            <div className="secret" role="status">
              <p>{t("device.secretTitle")}</p>
              <code>{enrollment.secret}</code>
              <p>{t("device.secretNotice")}</p>
              <p>
                {t("device.expires")}:{" "}
                {formatDate(enrollment.expiresAt, locale)}
              </p>
            </div>
          ) : null}
        </article>

        <article className="service-card" id="consent">
          <SectionHeading
            number={t("section.consentNumber")}
            title={t("section.consentTitle")}
          />
          <p>{t("consent.description")}</p>
          <ul className="policy-list">
            <li>{t("consent.named")}</li>
            <li>{t("consent.pause")}</li>
            <li>{t("consent.noAnonymous")}</li>
          </ul>
          {authenticated ? (
            <>
              <p className="state-line">
                {consent === null
                  ? t("consent.loading")
                  : consent.paused
                    ? t("consent.statePaused")
                    : t("consent.stateActive")}
              </p>
              <button
                className={
                  consent?.paused ? "secondary-action" : "danger-action"
                }
                type="button"
                disabled={working || consent === null}
                onClick={() => void setPaused(!consent?.paused)}
              >
                {consent?.paused
                  ? t("consent.resume")
                  : t("consent.pauseIncoming")}
              </button>
              <h3>{t("relationship.title")}</h3>
              <p>{t("relationship.description")}</p>
              <button
                className="secondary-action"
                type="button"
                disabled={working}
                onClick={() => void createRelationshipInvitation()}
              >
                {t("relationship.createInvitation")}
              </button>
              {relationshipInvitation !== null ? (
                <div className="secret" role="status">
                  <p>{t("relationship.invitationTitle")}</p>
                  <code>{relationshipInvitation.code}</code>
                  <p>{t("relationship.invitationNotice")}</p>
                  <p>
                    {t("relationship.expires")}:{" "}
                    {formatDate(relationshipInvitation.expiresAt, locale)}
                  </p>
                </div>
              ) : null}
              <form
                onSubmit={(event) => void acceptRelationshipInvitation(event)}
              >
                <label htmlFor="relationship-invitation">
                  {t("relationship.codeLabel")}
                </label>
                <input
                  id="relationship-invitation"
                  name="relationship_invitation"
                  type="text"
                  autoComplete="off"
                  required
                  minLength={43}
                  maxLength={43}
                  pattern="[A-Za-z0-9_-]{43}"
                  placeholder={t("relationship.codePlaceholder")}
                  value={invitationCode}
                  onChange={(event) => setInvitationCode(event.target.value)}
                />
                <button type="submit" disabled={working}>
                  {t("relationship.acceptInvitation")}
                </button>
              </form>
              <h3>{t("consent.connectedTitle")}</h3>
              {consent === null ? null : consent.connected_people.length ? (
                <div className="device-list">
                  {consent.connected_people.map((person) => (
                    <div className="device-record" key={person.person_id}>
                      <p className="connection-name">{person.display_name}</p>
                      <p className="bounded-notice">
                        {person.account_available
                          ? person.grant_active
                            ? t("consent.granted")
                            : t("consent.notGranted")
                          : t("consent.accountUnavailable")}
                      </p>
                      <button
                        className={
                          person.grant_active
                            ? "danger-action"
                            : "secondary-action"
                        }
                        type="button"
                        disabled={working || !person.account_available}
                        onClick={() =>
                          void setGrant(person.person_id, !person.grant_active)
                        }
                      >
                        {person.grant_active
                          ? t("consent.revoke")
                          : t("consent.grant")}
                      </button>
                      <button
                        className="danger-action"
                        type="button"
                        disabled={working}
                        onClick={() =>
                          void disconnectRelationship(person.person_id)
                        }
                      >
                        {t("relationship.disconnect")}
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="bounded-notice">{t("consent.noConnections")}</p>
              )}
            </>
          ) : (
            <p className="bounded-notice">{t("consent.signInRequired")}</p>
          )}
          <p className="bounded-notice">{t("consent.pending")}</p>
        </article>

        <article className="service-card truth-card">
          <SectionHeading
            number={t("section.truthNumber")}
            title={t("section.truthTitle")}
          />
          <div className="truth-grid">
            <Truth label={t("truth.request")} value={t("truth.unavailable")} />
            <Truth label={t("truth.delivery")} value={t("truth.disabled")} />
            <Truth label={t("truth.outcome")} value={t("truth.unknown")} />
          </div>
          <p className="bounded-notice">{t("truth.notice")}</p>
        </article>
      </section>

      <p className="feedback" aria-live="polite">
        {feedback}
      </p>

      <footer>
        <span>{t("footer.signature")}</span>
        <span>{t("footer.phase")}</span>
      </footer>
    </main>
  );
}

function Capability({
  label,
  enabled,
  messages,
}: {
  readonly label: string;
  readonly enabled: boolean;
  readonly messages: Messages;
}) {
  return (
    <div>
      <span>{label}</span>
      <strong className={enabled ? "enabled" : "disabled"}>
        {enabled ? messages["status.enabled"] : messages["status.disabled"]}
      </strong>
    </div>
  );
}

function SectionHeading({ number, title }: { number: string; title: string }) {
  return (
    <header className="section-heading">
      <span>{number}</span>
      <h2>{title}</h2>
    </header>
  );
}

function Truth({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatDate(value: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
