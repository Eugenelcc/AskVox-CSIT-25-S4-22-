import type { Session } from "@supabase/supabase-js";
import RegisteredMain from "./RegisteredMain";

export default function PaidMain({
  session,
  micEnabled,
  setMicEnabled,
}: {
  session: Session;
  micEnabled: boolean;
  setMicEnabled: (next: boolean | ((prev: boolean) => boolean)) => void;
}) {
  return <RegisteredMain session={session} paid micEnabled={micEnabled} setMicEnabled={setMicEnabled} />;
}
