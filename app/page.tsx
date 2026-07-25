import { Suspense } from "react";
import { WizardApp } from "./wizard-app";

export default function Home() {
  return (
    <Suspense fallback={null}>
      <WizardApp />
    </Suspense>
  );
}
