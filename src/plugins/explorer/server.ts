/**
 * What the Explorer registers (loaded with the other plugins' server modules, contributions.ts): its flow actions (fs.*, explorer.*) and
 * the live watchers of the watched folders. Its screen is the plugin's (explorer-ext, a view of the Workspace).
 */
import "./flow-actions";
import { startWatching } from "./watch";

startWatching();
