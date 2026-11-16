/**
 * The debts overview as the plugin's app view (contributes.appViews → views/debts.html): the built-in's own template (view-template.meta.ts) taken as it is and
 * converted — its data comes from the lambda `finances.debts-app` (`<data>`, data.app.*), its eight custom parts are made of the kit's own elements:
 * the figure changed in place for your own debts (a dialog), paying with a GiroCode (a dialog), removing an own debt (a confirmed button), the form for a new
 * debt (a dialog and a flow), your income (a dialog saving the preference), and the two charts (the kit's chart over rows the lambda gives).
 * Left out so far: who is on a debt's other side (changing it), and the promises to write down as debts. Called by scripts/port-finances.mts.
 */
import { translator } from "../../src/lib/i18n/shared";
import { DEBTS_VIEW } from "../../src/plugins/finances/view-template.meta";

const MONEY: Record<string, { text: string; label: string }> = {
  total: { text: "{{ total | euro }}", label: "Total" },
  open: { text: "{{ open | euro }}", label: "Open" },
  installment: { text: "{{ installment | euro | default('—') }}", label: "Instalment" },
  due: { text: "{{ dueText | default('—') }}", label: "Next due" },
};

export function debtsViewTemplate(): string {
  const t = translator("en");
  let s = DEBTS_VIEW.defaultTemplate(t);

  // 1) the data: the lambda's, not the page's app.* — loading and error as the kit's <data> says them
  s = s.replace(/\{\{#if app\.loading\}\}/g, "{{#if not data.app}}").replace(/\{\{#if app\.error\}\}/g, "{{#if data.app_error}}").replace(/\{\{ app\.error \}\}/g, "{{ data.app_error }}");
  s = s.replace(/(^|[^\w.])app\./g, "$1data.app.");
  s = s.replace(
    '<state name="fixed" value="true"/>',
    `<state name="fixed" value="true"/>
<state name="edit" value=""/>
<state name="paying" value=""/>
<state name="addopen" value=""/>
<state name="sideedit" value=""/>
<state name="incomeedit" value=""/>
<data name="app" lambda="finances.debts-app" with="dir={{ state.dir }}, withFixed={{ state.fixed }}"/>
<on event="debt-changed" action="reload"/>`,
  );

  // 2) the parts
  s = s.replace(/<part name="debts\.money" field="(\w+)" debt="\{\{ id \}\}"\/>/g, (_m, f: string) => {
    const m = MONEY[f];
    return `{{#if manual}}<button action="state" state="edit" value="{{ id }}" label="${m.text}" variant=link/>{{#else}}${m.text}{{/if}}`;
  });
  s = s.replace(/<part name="debts\.side" debt="\{\{ id \}\}"\/>/g, '{{#if creditorId}}<button action="state" state="sideedit" value="{{ id }}" label="✎" variant=quiet/>{{/if}}');
  s = s.replace(/<part name="debts\.pay" debt="\{\{ id \}\}"\/>/g, '<button action="state" state="paying" value="{{ id }}" label="Pay" variant=plain/>');
  s = s.replace(/<part name="debts\.delete" debt="\{\{ id \}\}"\/>/g, '<button do="db.archive" with="row={{ id }}" confirm="Remove this debt?" emit="debt-changed" label="✕" variant=quiet/>');
  s = s.replace(
    '<part name="debts.income"/>',
    `<button action="state" state="incomeedit" value="1" label="{{ data.app.income | euro(0) | default('Set your income') }}" variant=link/>`,
  );
  s = s.replace('<part name="debts.add"/>', `<row gap=2 justify=end><button action="state" state="addopen" value="1" label="+ Debt" variant=primary/></row>`);
  s = s.replace('<part name="debts.balance-chart"/>', `<chart kind=line source="data.app.balance" group="label" value="value"/>`);
  s = s.replace('<part name="debts.monthly-chart"/>', `<chart kind=column source="data.app.monthlyRows" group="month" value="amount" series="name"/>`);
  if (/<part /.test(s)) throw new Error("debts view: a part of the built-in's template has no replacement: " + (/<part [^>]*>/.exec(s)?.[0] ?? ""));

  // 3) the dialogs, once, before the end of the page
  const owner = "{{#if not data.app}}";
  void owner;
  const dialogs = `
<dialog bind="edit" title="Change this debt">
  {{#each data.app.debts | where('id', state.edit)}}
  <col gap=2>
    <heading level=3>{{ creditor }}</heading>
    <grid cols=2 gap=2 min=150>
      <input bind="e_total" type=number label="Total" value="{{ total }}"/>
      <input bind="e_open" type=number label="Open" value="{{ open }}"/>
      <input bind="e_installment" type=number label="Instalment" value="{{ installment }}"/>
      <input bind="e_due" type=date label="Next due" value="{{ due }}"/>
      <input bind="e_day" type=number label="Plan's day of the month" value="{{ day }}"/>
    </grid>
    <row gap=2>
      <button do="db.set-cells" with="row={{ id }}, cells.debttotal={{ state.e_total }}, cells.debtopen={{ state.e_open }}, cells.debtrate={{ state.e_installment }}, cells.debtdue={{ state.e_due }}, cells.debtday={{ state.e_day }}" done="Saved." then="edit=" emit="debt-changed" label="Save" variant=primary/>
    </row>
  </col>
  {{/each}}
</dialog>

<dialog bind="paying" title="Pay">
  {{#each data.app.debts | where('id', state.paying)}}{{#if payment}}
  <col gap=2>
    <heading level=3>{{ payment.name }}</heading>
    <girocode name="{{ payment.name }}" iban="{{ payment.iban }}" bic="{{ payment.bic }}" amount="{{ payment.amount }}" purpose="{{ payment.purpose }}"/>
    <small><muted>{{ payment.iban }} · {{ payment.amount | euro }} · {{ payment.purpose }}</muted></small>
  </col>
  {{/if}}{{/each}}
</dialog>

<dialog bind="incomeedit" title="Your income a month">
  <col gap=2>
    <input bind="incomeval" type=number label="Net income a month" value="{{ data.app.income }}"/>
    <row gap=2>
      <button do="pref.set" with="plugin=finances-ext, key=cases.income, value={{ state.incomeval }}" then="incomeedit=" emit="debt-changed" label="Save" variant=primary/>
      <button do="pref.set" with="plugin=finances-ext, key=cases.income, value=null" then="incomeedit=" emit="debt-changed" label="Use what the statements say"/>
    </row>
  </col>
</dialog>

<dialog bind="sideedit" title="Who is on the other side?">
  {{#each data.app.debts | where('id', state.sideedit)}}
  <col gap=2>
    <input bind="s_who" label="A contact's name — a new one is made" value="{{ creditor }}"/>
    <row gap=2>
      <button run="finances.set-side" with="row={{ id }}, who={{ state.s_who }}" done="Saved." then="sideedit=" emit="debt-changed" label="Save" variant=primary/>
    </row>
  </col>
  {{/each}}
</dialog>

<dialog bind="addopen" title="New debt or claim">
  <col gap=2>
    {{#if data.app.suggestions}}
    <box>
      <small><muted>Your promises with an amount — write them down as debts?</muted></small>
      {{#each data.app.suggestions}}
      <row gap=2 justify=between>
        <col><b>{{ name }} · {{ amount | euro }}{{#if dueText}} · {{ dueText }}{{/if}}</b><small><muted>{{ text }}</muted></small></col>
        <button run="finances.debt-from-claim" with="who={{ name }}, dir={{ dir }}, amount={{ amount }}, due={{ due }}, claim={{ claimId }}" done="Added." emit="debt-changed" label="+ As a debt"/>
      </row>
      {{/each}}
    </box>
    {{/if}}
    <row gap=2><button action="state" state="n_dir" value="owe" label="I owe" variant="{{ state.n_dir == 'owed' ? 'plain' : 'primary' }}"/><button action="state" state="n_dir" value="owed" label="Owed to me" variant="{{ state.n_dir == 'owed' ? 'primary' : 'plain' }}"/></row>
    <input bind="n_who" label="Other side (a contact's name — a new one is made)"/>
    <input bind="n_what" label="What for"/>
    <grid cols=2 gap=2 min=150>
      <input bind="n_amount" type=number label="Amount"/>
      <input bind="n_installment" type=number label="Instalment a month"/>
      <input bind="n_due" type=date label="Next due"/>
    </grid>
    <row gap=2>
      <button run="finances.add-debt" with="dir={{ state.n_dir }}, who={{ state.n_who }}, what={{ state.n_what }}, amount={{ state.n_amount }}, installment={{ state.n_installment }}, due={{ state.n_due }}" done="Added." then="addopen=" emit="debt-changed" label="Add" variant=primary/>
    </row>
  </col>
</dialog>
`;
  // before the closing of the data branch ({{/if}} of "not data.app")
  const at = s.lastIndexOf("{{/if}}");
  s = at >= 0 ? s.slice(0, at) + dialogs + "\n" + s.slice(at) : s + dialogs;
  return s;
}
