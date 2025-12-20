import type { Session } from "@supabase/supabase-js";
import RegisteredMain from "./RegisteredMain";

export default function PaidMain({ session }: { session: Session }) {
  return <RegisteredMain session={session} paid />;
}
