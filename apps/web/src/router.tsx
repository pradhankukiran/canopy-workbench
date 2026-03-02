import { createBrowserRouter } from "react-router-dom";
import { AppShell } from "@/components/layout/app-shell";
import { ModuleSelectionPage } from "@/pages/module-selection";
import { NotFoundPage } from "@/pages/not-found";
import { PricingPage } from "@/features/pricing/pricing-page";
import { IlsTriggerPage } from "@/features/ils-trigger/ils-trigger-page";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: <ModuleSelectionPage /> },
      { path: "property-cat-pricing", element: <PricingPage /> },
      { path: "ils-parametric-trigger", element: <IlsTriggerPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);
