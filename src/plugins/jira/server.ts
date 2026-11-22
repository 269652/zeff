import { workspaceSources } from "@/plugins/workspace/source-point";
import { flowActionsPoint } from "@/plugins/workspace/flows/actions";
import { JIRA_FLOW_ACTIONS } from "./flow-actions";
import { JIRA_TICKETS_SOURCE } from "./tickets-source";
import { JIRA_COMMENTS_SOURCE } from "./workspace-source";
import { refCardProviders } from "@/lib/refs/point";
import { TICKET_REF_CARD } from "./ref-card";

/**
 * What Jira registers for other plugins (loaded through plugins/contributions): its comments as something the Workspace's databases can join,
 * its tickets as the source of Jira's app in the Workspace, and what flows can do in Jira (comment, move, assign, sync).
 */
workspaceSources.contribute("jira", [JIRA_COMMENTS_SOURCE, JIRA_TICKETS_SOURCE]);
flowActionsPoint.contribute("jira", JIRA_FLOW_ACTIONS);
// A ticket key named in a text: its hover card (summary, status, assignee, the last comment).
refCardProviders.contribute("jira", [TICKET_REF_CARD]);
