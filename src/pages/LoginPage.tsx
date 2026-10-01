import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../services/supabase";

type DemoScenario = {
  scenario_id: string;
  title: string;
  payload: Record<string, unknown>;
};

const demoIds = [
  "synthetic-overview-v1",
  "synthetic-replay-v1",
  "synthetic-energy-v1",
];

function ArrowIcon() {
  return (
    <svg
      aria-hidden="true"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12h14m-6-6 6 6-6 6" />
    </svg>
  );
}

function isPublicDemo(value: unknown): value is DemoScenario {
  if (typeof value !== "object" || value === null) return false;

  const row = value as Record<string, unknown>;
  const payload = row["payload"];

  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    return false;
  }

  const fields = payload as Record<string, unknown>;

  return (
    typeof row["scenario_id"] === "string" &&
    typeof row["title"] === "string" &&
    row["data_scope"] === "synthetic_public_demo" &&
    fields["origin"] === "synthetic_public_demo" &&
    fields["fictional"] === true &&
    typeof fields["display_notice"] === "string"
  );
}

function numericField(value: unknown, name: string): number | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const field = (value as Record<string, unknown>)[name];
  return typeof field === "number" && Number.isFinite(field) ? field : null;
}

function DemoDetails({ scenario }: { scenario: DemoScenario }) {
  const payload = scenario.payload;

  if (scenario.scenario_id === "synthetic-overview-v1") {
    const summary = payload["summary"];

    return (
      <p>
        {numericField(summary, "incident_count") ?? "—"} invented incidents ·{" "}
        {numericField(summary, "recorded_downtime_hours") ?? "—"} illustrative
        downtime hours · {numericField(summary, "actual_loss_kusd") ?? "—"} kUSD
        illustrative actual loss
      </p>
    );
  }

  if (scenario.scenario_id === "synthetic-replay-v1") {
    const observations = payload["observations_available_by_cutoff"];
    if (!Array.isArray(observations)) return null;

    return (
      <ul className="demo-values">
        {observations.map((item: unknown, index: number) => {
          if (typeof item !== "object" || item === null) return null;

          const row = item as Record<string, unknown>;
          if (
            typeof row["timestamp"] !== "string" ||
            typeof row["vibration"] !== "number"
          ) {
            return null;
          }

          return (
            <li key={`${row["timestamp"]}-${index}`}>
              {row["timestamp"]}: {row["vibration"]} mm/s (invented)
            </li>
          );
        })}
      </ul>
    );
  }

  if (scenario.scenario_id === "synthetic-energy-v1") {
    const horizons = payload["horizon_minutes"];
    const predictions = payload["predicted_kwh_by_horizon"];

    if (!Array.isArray(horizons) || !Array.isArray(predictions)) return null;

    return (
      <ul className="demo-values">
        {horizons.map((minutes: unknown, index: number) => {
          const kwh: unknown = predictions[index];
          if (typeof minutes !== "number" || typeof kwh !== "number")
            return null;

          return (
            <li key={`${minutes}-${index}`}>
              +{minutes} min: {kwh} kWh (invented)
            </li>
          );
        })}
      </ul>
    );
  }

  return null;
}

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [demos, setDemos] = useState<DemoScenario[]>([]);
  const [demoStatus, setDemoStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [signedInEmail, setSignedInEmail] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authMessage, setAuthMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadPublicDemos() {
      const { data, error } = await supabase
        .from("demo_scenarios")
        .select("scenario_id,title,data_scope,payload")
        .in("scenario_id", demoIds)
        .order("scenario_id");

      if (!active) return;

      if (error) {
        setDemoStatus("error");
        return;
      }

      setDemos(
        (data ?? [])
          .filter(isPublicDemo)
          .sort(
            (a, b) =>
              demoIds.indexOf(a.scenario_id) - demoIds.indexOf(b.scenario_id),
          ),
      );
      setDemoStatus("ready");
    }

    async function restoreAccount() {
      const { data: userResult } = await supabase.auth.getUser();
      const user = userResult.user;
      if (!user) return;

      const { data: membership } = await supabase
        .from("app_memberships")
        .select("is_active")
        .eq("user_id", user.id)
        .maybeSingle();

      if (active && membership?.is_active) {
        setSignedInEmail(user.email ?? "Judge account");
      }
    }

    void loadPublicDemos();
    void restoreAccount();

    return () => {
      active = false;
    };
  }, []);

  async function handleSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (authBusy) return;

    setAuthBusy(true);
    setAuthMessage(null);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error || !data.user) {
        setAuthMessage("Sign-in failed. Check your email and password.");
        return;
      }

      const { data: membership, error: membershipError } = await supabase
        .from("app_memberships")
        .select("is_active")
        .eq("user_id", data.user.id)
        .maybeSingle();

      if (membershipError || !membership?.is_active) {
        await supabase.auth.signOut();
        setAuthMessage("This account has not been granted access to Case 2.");
        return;
      }

      setSignedInEmail(data.user.email ?? "Judge account");
      const requested = (location.state as { from?: unknown } | null)?.from;
      navigate(typeof requested === "string" && /^\/(dashboard|data|sources)(\/|$)/.test(requested)
        ? requested : "/dashboard", { replace: true });
    } catch {
      setAuthMessage("Sign-in is temporarily unavailable. Please try again.");
    } finally {
      setPassword("");
      setAuthBusy(false);
    }
  }

  async function handleSignOut() {
    const { error } = await supabase.auth.signOut();

    if (error) {
      setAuthMessage("Sign-out failed. Please try again.");
      return;
    }

    setSignedInEmail(null);
    setAuthMessage(null);
  }

  return (
    <div className="landing-page">
      <header className="landing-header">
        <div className="brand-mark" aria-hidden="true">
          S
        </div>
        <div>
          <p className="eyebrow">SYNKARA · CALIBER 2026 · CASE 2</p>
          <p className="brand-name">TRACE-MI</p>
        </div>
      </header>

      <main>
        <div className="entry-layout">
          <section className="entry-copy" aria-labelledby="entry-heading">
            <p className="scope-label">CALIBER 2026 / CASE 2</p>
            <h1 id="entry-heading">
              From an issue to an accountable action.
            </h1>
            <p>
              Explore the supplied manufacturing records, inspect a case, and track a reviewed follow-up.
            </p>
            <p className="story-flow">
              Overview <span aria-hidden="true">→</span> Investigate{" "}
              <span aria-hidden="true">→</span> Act
            </p>
          </section>

          <section className="judge-panel" aria-labelledby="judge-heading">
            <p className="scope-label">ONE SHARED DEMO ACCOUNT</p>
            <h2 id="judge-heading">Enter the workspace</h2>
            <p>Use the judge credentials provided by SYNKARA. All demo sections use this same account.</p>

            {signedInEmail ? (
              <div className="account-status" role="status">
                <p>Demo session active.</p>
                <Link className="primary-link" to="/dashboard">
                  Open Case 2 workspace <ArrowIcon />
                </Link>
                <button
                  className="secondary-action"
                  type="button"
                  onClick={() => {
                    void handleSignOut();
                  }}
                >
                  Sign out
                </button>
              </div>
            ) : (
              <form
                className="login-form"
                onSubmit={(event) => {
                  void handleSignIn(event);
                }}
              >
                <label htmlFor="judge-email">Email</label>
                <input
                  id="judge-email"
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />

                <label htmlFor="judge-password">Password</label>
                <input
                  id="judge-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />

                <button type="submit" disabled={authBusy}>
                  {authBusy ? "Signing in…" : "Sign in to Case 2"}
                  <ArrowIcon />
                </button>
                <div className="login-judge-note">
    <strong>Judge access</strong>
    <p>Enter the demo email and password provided by Team SYNKARA through the official CALIBER submission form. Access instructions are also available in the GitHub repository.</p>
  </div>
</form>
            )}

            {authMessage && (
              <p className="auth-message" role="alert">
                {authMessage}
              </p>
            )}
          </section>
        </div>

        <details
          className="public-walkthrough"
          id="public-demo"
        >
          <summary>See fictional examples without signing in</summary>
          <div className="demo-heading">
            <div>
              <p className="scope-label">PUBLIC WALKTHROUGH · FICTIONAL DATA</p>
              <h2 id="demo-heading">Explore the idea without signing in</h2>
              <p>
                Every number below is invented for this demonstration. Case 2
                source records require a permitted account.
              </p>
            </div>
            <a className="secondary-link" href="#demo-scenarios">
              View examples <ArrowIcon />
            </a>
          </div>

          <div
            className="demo-section"
            id="demo-scenarios"
            aria-label="Illustrative scenarios"
          >
            {demoStatus === "loading" && (
              <p role="status">Loading illustrative scenarios…</p>
            )}
            {demoStatus === "error" && (
              <p role="alert">
                The public walkthrough is unavailable. Please try again later.
              </p>
            )}
            {demoStatus === "ready" && demos.length === 0 && (
              <p role="status">
                No reviewed public scenarios are available yet.
              </p>
            )}
            {demoStatus === "ready" &&
              demos.map((scenario) => (
                <article className="demo-card" key={scenario.scenario_id}>
                  <p className="scope-label">ILLUSTRATIVE DEMO</p>
                  <h3>{scenario.title}</h3>
                  <p>{String(scenario.payload["display_notice"])}</p>
                  <DemoDetails scenario={scenario} />
                </article>
              ))}
          </div>
        </details>
      </main>
    </div>
  );
}
