/**
 * The calendar's page as the plugin's app view (contributes.appViews → views/calendar.html): the built-in's own template (view-template.meta.ts: the toolbar and the
 * sidebar) taken as it is and converted — its data comes from the lambda `calendar.screen` (`<data>`, data.cal.*), its three React parts replaced by the kit's elements:
 * the grid is `<schedule>` (day, week, month, agenda — click opens the details, dragging moves or resizes through the flow `calendar.move`, dragging on free time opens the
 * new-event form), a calendar's switch is a button that saves "shown" through the flow `calendar.calendar`, the small month a date field. The details and the new-event form
 * are dialogs. Left out so far: the dotted small month, changing an existing appointment's words (drag it, or delete and make it again), repeating series and guests in the form,
 * the keyboard shortcuts, the merged "Done" stripes. Called by scripts/port-calendar.mts.
 */
import { translator } from "../../src/lib/i18n/shared";
import { CALENDAR_VIEW } from "../../src/plugins/calendar/view-template.meta";

export function calendarViewTemplate(): string {
  const t = translator("en");
  let s = CALENDAR_VIEW.defaultTemplate(t);

  // 1) the data: the lambda's, not the page's app.*
  s = s.replace(/(^|[^\w.])app\./g, "$1data.cal.");
  s = s.replace(
    '<state name="proposed" value="true"/>',
    `<state name="proposed" value="true"/>
<data name="cal" lambda="calendar.screen" with="view={{ state.view }}, day={{ state.day }}, proposed={{ state.proposed }}"/>
<on event="cal-changed" action="reload"/>
<on event="cal-changed" action="state" state="e_title" value=""/>
<on event="newevent" action="state" state="e_start" value="{{ data.cal.newStart }}"/>
<on event="newevent" action="state" state="e_end" value="{{ data.cal.newEnd }}"/>
<on event="newevent" action="state" state="e_all" value=""/>
<on event="opened" action="state" state="detail" value="{{ state.picked }}"/>
<on event="made" action="state" state="e_start" value="{{ state.picked_start }}"/>
<on event="made" action="state" state="e_end" value="{{ state.picked_end }}"/>
<on event="made" action="state" state="e_all" value="{{ state.picked_allday }}"/>
<on event="made" action="state" state="edit" value="new"/>
<on event="moved" run="calendar.move" with="item={{ state.picked }}, start={{ state.picked_start }}, end={{ state.picked_end }}" emit="cal-changed"/>`,
  );

  // 2) the actions
  const act = (name: string, body: string) => {
    const re = new RegExp(`<button action="${name.replace(/\./g, "\\.")}"[^>]*/>`, "g");
    if (!re.test(s)) throw new Error(`calendar view: the action ${name} is not in the built-in's template.`);
    s = s.replace(re, body);
  };
  act("calendar.new", `<button action="state" state="edit" value="new" emit="newevent" label="+ ${t("New event")}" variant=primary phone="hide"/>`);
  act("calendar.sync", `<button run="google-calendar.sync" with="from={{ data.cal.syncFrom }}, to={{ data.cal.syncTo }}" done="Synced." emit="cal-changed" label="⟳ ${t("Sync")}" phone="hide"/>`);

  // 3) the parts
  const rep = (re: RegExp, body: string) => {
    if (!re.test(s)) throw new Error(`calendar view: ${re} is not in the built-in's template.`);
    s = s.replace(re, body);
  };
  rep(/<part name="calendar\.minimonth"\/>/g, `<input bind="day" type=date label="${t("Go to a day")}"/>`);
  rep(
    /<part name="calendar\.toggle" calendar="\{\{ id \}\}" label="\{\{ name \}\}"\/>/g,
    `<button run="calendar.calendar" with="op=update, id={{ id }}, visible={{ visible ? 'false' : 'true' }}" emit="cal-changed" label="{{ mark }} {{ name }}" variant=quiet/>`,
  );
  rep(/<part name="calendar\.toggle" calendar="proposed" label="[^"]*"\/>/g, `<toggle bind="proposed" label="${t("Proposed by todos")}"/>`);
  rep(
    /<part name="calendar\.grid"\/>/g,
    `<col fill=true>
<schedule source="data.cal.items" start="start" end="end" title="title" id="id" color="color" allday="allDay" editable="editable" view="{{ state.view }}" day="{{ state.day }}" bind="picked" emit="opened" move="moved" create="made" daybind="day" empty="${t("Nothing in this time.")}"/>
</col>`,
  );
  if (/<part /.test(s)) throw new Error("calendar view: a part of the built-in's template has no replacement: " + (/<part [^>]*>/.exec(s)?.[0] ?? ""));

  // 4) the dialogs: the details of an appointment, a new one
  const dialogs = `
<dialog bind="detail" title="${t("Appointment")}">
{{#each data.cal.items | where('id', state.detail)}}
<col gap=3>
  <heading level=3>{{ title }}</heading>
  <muted>{{ when }} · {{ calendar }}</muted>
  {{#if location}}<text>📍 {{ location }}</text>{{/if}}
  {{#if organizer}}<small><muted>${t("Organiser")}: {{ organizer }}</muted></small>{{/if}}
  {{#if attendees}}<small><muted>${t("With")}: {{#each attendees}}{{ a }}; {{/each}}</muted></small>{{/if}}
  {{#if response}}<small><muted>${t("Your answer")}: {{ response }}</muted></small>{{/if}}
  {{#if online}}<small><muted>${t("Online meeting")}</muted></small>{{/if}}
  {{#if description}}<text tone=muted>{{ description }}</text>{{/if}}
  {{#if todoRef}}<small><muted>${t("A todo proposes it")}: {{ todoRef }}</muted></small>{{/if}}
  {{#if url}}<a href="{{ url }}">${t("Open in source")} ↗</a>{{/if}}
  <row gap=2 wrap=true>
    {{#if canDecide}}
    <button run="calendar.decide" with="id={{ eventId }}, verdict=accepted" done="Accepted." then="detail=" emit="cal-changed" label="${t("Accept")}" variant=primary/>
    <button run="calendar.decide" with="id={{ eventId }}, verdict=dismissed" done="Dismissed." then="detail=" emit="cal-changed" label="${t("Dismiss")}"/>
    {{/if}}
    {{#if todoId}}{{#if todoTitle}}
    <button run="calendar.accept-todo-proposal" with="todo={{ todoId }}, index={{ index }}, title={{ todoTitle }}" done="Entered." then="detail=" emit="cal-changed" label="${t("Accept")}" variant=primary/>
    {{/if}}{{/if}}
    {{#if canRespond}}
    <button run="calendar.respond" with="id={{ eventId }}, response=accepted" done="Accepted." then="detail=" emit="cal-changed" label="${t("Accept")}" variant=primary/>
    <button run="calendar.respond" with="id={{ eventId }}, response=tentative" done="Answered." then="detail=" emit="cal-changed" label="${t("Maybe")}"/>
    <button run="calendar.respond" with="id={{ eventId }}, response=declined" done="Declined." then="detail=" emit="cal-changed" label="${t("Decline")}"/>
    {{/if}}
    {{#if canDelete}}
      {{#if series}}
      <button run="calendar.delete" with="id={{ eventId }}, occurrence={{ occurrence }}, scope=one" confirm="${t("Delete this event?")}" done="Deleted." then="detail=" emit="cal-changed" label="${t("Delete this event")}" variant=danger/>
      <button run="calendar.delete" with="id={{ eventId }}, occurrence={{ occurrence }}, scope=following" confirm="${t("Delete this and the following events?")}" done="Deleted." then="detail=" emit="cal-changed" label="${t("This and following")}" variant=danger/>
      <button run="calendar.delete" with="id={{ eventId }}, scope=all" confirm="${t("Delete the whole series?")}" done="Deleted." then="detail=" emit="cal-changed" label="${t("All events")}" variant=danger/>
      {{#else}}
      <button run="calendar.delete" with="id={{ eventId }}" confirm="${t("Delete this event?")}" done="Deleted." then="detail=" emit="cal-changed" label="${t("Delete")}" variant=danger/>
      {{/if}}
    {{/if}}
  </row>
</col>
{{/each}}
</dialog>

<dialog bind="edit" title="${t("New event")}">
<col gap=2>
  <input bind="e_title" label="${t("Add title")}"/>
  <input bind="e_start" label="${t("From (2026-11-16T09:30, or just the day for an all-day event)")}" value="{{ data.cal.newStart }}"/>
  <input bind="e_end" label="${t("To")}" value="{{ data.cal.newEnd }}"/>
  <toggle bind="e_all" label="${t("All day")}"/>
  {{#if data.cal.calendarOptions}}<select bind="e_cal" options="{{ data.cal.calendarOptions }}" label="${t("Calendar")}"/>{{/if}}
  <input bind="e_loc" label="${t("Location")}"/>
  <input bind="e_desc" type=textarea rows=3 label="${t("Description")}"/>
  <row gap=2>
    <button run="calendar.save" with="title={{ state.e_title }}, start={{ state.e_start }}, end={{ state.e_end }}, allDay={{ state.e_all }}, calendarId={{ state.e_cal }}, location={{ state.e_loc }}, description={{ state.e_desc }}" done="Saved." then="edit=" emit="cal-changed" label="${t("Save")}" variant=primary disabled="{{ not state.e_title }}"/>
    <button run="calendar.propose" with="title={{ state.e_title }}, start={{ state.e_start }}, end={{ state.e_end }}, allDay={{ state.e_all }}, calendarId={{ state.e_cal }}, location={{ state.e_loc }}, description={{ state.e_desc }}" done="Proposed." then="edit=" emit="cal-changed" label="${t("As a proposal")}" disabled="{{ not state.e_title }}"/>
    <button action="state" state="edit" value="" label="${t("Cancel")}" variant=quiet/>
  </row>
</col>
</dialog>
`;
  return s + "\n" + dialogs;
}
