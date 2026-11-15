import { flowActionsPoint } from "@/plugins/workspace/flows/actions";
import { TEAMS_FLOW_ACTIONS } from "./flow-actions";

/** What Teams registers for other plugins (loaded through plugins/contributions): what a Teams port's sync flow needs around its scraper. */
flowActionsPoint.contribute("teams", TEAMS_FLOW_ACTIONS);
