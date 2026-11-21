import { t } from "@/lib/i18n/server";
import { LoadingScreen } from "@/components/LoadingScreen";

/** While a page loads (a tab switched): at once, in the middle of where it will be, a calm sign that it's coming. */
export default function Loading() {
  return <LoadingScreen label={t("Loading")} />;
}
