import { useEffect, useState } from "react";
import { IncomingCall } from "../../demo/IncomingCall";
import { formatAmount, shortAddr } from "../../lib/format";
import { useVault, type Withdrawal } from "../store";

/**
 * When Sentinel raises a critical alert on your vault, Argus calls you here:
 * the same call screen and voice agent as the live demo. "Cancel it" sends
 * cancel_withdrawal from your own wallet; "it was me" asks for a signed
 * dismissal (a guardian's, for critical alerts). Ignore it and the AI cancels
 * when its time is up.
 */
const seenKey = (id: string) => `argus:called:${id}`;
const wasSeen = (id: string) => {
  try {
    return sessionStorage.getItem(seenKey(id)) === "1";
  } catch {
    return false;
  }
};
const markSeen = (id: string) => {
  try {
    sessionStorage.setItem(seenKey(id), "1");
  } catch {
    /* ignore */
  }
};

export function ArgusCalling() {
  const { vault, cancel, dismiss } = useVault();
  const ringing = vault.pending.find((w) => w.risk === "critical" && w.alertId && !wasSeen(w.alertId));
  const [call, setCall] = useState<Withdrawal | null>(null);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    if (!call && ringing) {
      setCall(ringing);
      setGone(false);
    }
  }, [call, ringing]);

  // The withdrawal left the pending list (cancelled or dismissed): the call is over.
  const stillPending = call ? vault.pending.some((w) => w.pda === call.pda && w.risk === "critical") : false;
  useEffect(() => {
    if (call && !stillPending) setGone(true);
  }, [call, stillPending]);

  if (!call || !call.alertId) return null;
  const close = () => {
    markSeen(call.alertId!);
    setCall(null);
  };
  const amount = `${formatAmount(call.amount, vault.decimals)} ${vault.symbol}`;
  const started = call.alertAt ?? Date.now();
  const timeout = call.actAt ? Math.max(5, Math.round((call.actAt - started) / 1000)) : 40;

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center overflow-y-auto bg-[#0b1020]/45 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Argus is calling">
      <div className="relative w-full max-w-[340px] py-6">
        <button type="button" onClick={close} className="absolute -top-1 right-0 rounded-full bg-white/90 px-3 py-1 text-[12.5px] text-fg shadow hover:bg-white">
          Close
        </button>
        <IncomingCall
          session=""
          amount={amount}
          reason={call.reason ?? "This withdrawal looks like theft."}
          timeoutSecs={timeout}
          startedAt={started}
          decided={gone ? "cancel" : null}
          onAnswered={() => markSeen(call.alertId!)}
          actions={{
            vaultName: vault.name,
            destination: shortAddr(call.destination),
            footnote: "Argus calls you in the app when a withdrawal looks like theft. Cancelling signs with your own wallet.",
            noAnswerText: "No answer in {s}s and Argus cancels it.",
            cancel: async () => {
              const ok = await cancel(call);
              return ok === false ? "The cancel didn't go through from the wallet. Tell them to press Cancel on the withdrawal in the app." : "Cancelled, signed with your own wallet. The money stays in the vault.";
            },
            allow: async () => {
              const err = dismiss ? await dismiss(call) : "Not available.";
              return err ? `That couldn't be confirmed: ${err}` : "Confirmed. Argus stands down for this withdrawal.";
            },
            decline: async () => close(),
          }}
        />
      </div>
    </div>
  );
}
