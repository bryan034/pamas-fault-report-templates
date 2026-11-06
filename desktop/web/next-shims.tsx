// Browser-only stand-ins for the few Next.js APIs the shared components import.
import { lazy, Suspense, type ComponentType, type ReactNode } from "react";

export const usePathname = () => window.location.pathname;

const router = {
  replace: (url: string) => window.location.replace(url),
  push: (url: string) => window.location.assign(url),
};
export const useRouter = () => router;

export default function dynamic<Props extends object>(
  load: () => Promise<{ default: ComponentType<Props> }>,
  options: { loading?: () => ReactNode } = {},
) {
  const Component = lazy(load) as unknown as ComponentType<Props>;
  return function DynamicComponent(props: Props) {
    return <Suspense fallback={options.loading?.() ?? null}><Component {...props} /></Suspense>;
  };
}
