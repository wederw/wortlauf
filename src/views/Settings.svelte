<script>
  import { onMount } from 'svelte';
  import { exportBackup, importBackup } from '../lib/backup.js';
  import { importScript, localScripts, removeScript } from '../lib/engine.js';
  import { app, go, loadSettings, READER_FONTS, saveSettings, THEMES, toast } from '../lib/state.svelte.js';

  const HOOK = { tokenize: 'Zerlegung', timing: 'Tempo', layout: 'Anzeige', flow: 'Ablauf', stats: 'Auswertung' };

  let editing = $state(app.settings.activeProfile);
  let scripts = $state([]);
  let usage = $state(null);

  const profile = $derived(app.settings.profiles.find((p) => p.id === editing) ?? app.settings.profiles[0]);
  const manifest = (id) => app.plugins.find((p) => p.id === id);
  const broken = $derived(app.plugins.filter((p) => p.error));

  function addProfile() {
    const copy = $state.snapshot(profile);
    copy.id = `p${Date.now().toString(36)}`;
    copy.name = `${profile.name} (Kopie)`;
    app.settings.profiles.push(copy);
    editing = copy.id;
    saveSettings();
  }

  function removeProfile() {
    if (app.settings.profiles.length <= 1 || !confirm(`Profil „${profile.name}“ löschen?`)) return;
    app.settings.profiles = app.settings.profiles.filter((p) => p.id !== profile.id);
    if (app.settings.activeProfile === profile.id) app.settings.activeProfile = app.settings.profiles[0].id;
    editing = app.settings.profiles[0].id;
    saveSettings();
  }

  function move(index, by) {
    const list = profile.plugins;
    const target = index + by;
    if (target < 0 || target >= list.length) return;
    [list[index], list[target]] = [list[target], list[index]];
    saveSettings();
  }

  function setValue(entry, key, value) {
    entry.settings = { ...entry.settings, [key]: value };
    saveSettings();
  }

  /** Opens a file picker and hands the chosen file to `use`. */
  function pick(accept, use) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        await use(file);
      } catch (error) {
        toast(error.message, 'error');
      }
    };
    input.click();
  }

  const addScript = () =>
    pick('.js,.mjs,text/javascript', async (file) => {
      const script = await importScript(file);
      scripts = await localScripts();
      const loaded = app.plugins.find((p) => p.id === script.id);
      if (loaded?.error) toast(`${file.name} lässt sich nicht laden: ${loaded.error}`, 'error');
      else toast(`„${loaded?.name ?? file.name}“ ist jetzt in jedem Profil verfügbar, zunächst abgeschaltet.`);
    });

  async function dropScript(script) {
    if (!confirm(`Script „${script.name}“ aus diesem Browser entfernen?`)) return;
    await removeScript(script.id).catch((error) => toast(error.message, 'error'));
    scripts = await localScripts();
  }

  const restore = () =>
    pick('.json,application/json', async (file) => {
      const summary = await importBackup(file);
      await loadSettings();
      editing = app.settings.activeProfile;
      scripts = await localScripts();
      toast(summary);
    });

  async function backup() {
    try {
      await exportBackup();
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  const megabytes = (bytes) =>
    bytes >= 1024 ** 3
      ? `${(bytes / 1024 ** 3).toFixed(1).replace('.', ',')} GB`
      : `${(bytes / 1024 ** 2).toFixed(bytes < 10 * 1024 ** 2 ? 1 : 0).replace('.', ',')} MB`;

  onMount(async () => {
    scripts = await localScripts().catch(() => []);
    try {
      const estimate = await navigator.storage?.estimate?.();
      const persisted = await navigator.storage?.persisted?.();
      if (estimate) usage = { used: estimate.usage ?? 0, quota: estimate.quota ?? 0, persisted };
    } catch {
      /* not supported */
    }
  });
</script>

<main class="page">
  <header class="topbar">
    <h1>Einstellungen</h1>
    <nav><button class="quiet" onclick={() => go('')}>Zur Bibliothek</button></nav>
  </header>

  <section>
    <h2>Darstellung</h2>
    <div class="grid">
      <label class="field">
        <span>Farbschema</span>
        <select bind:value={app.settings.theme} onchange={saveSettings}>
          {#each Object.entries(THEMES) as [value, label]}<option {value}>{label}</option>{/each}
        </select>
      </label>
      <label class="field">
        <span>Schrift im Lesemodus</span>
        <select bind:value={app.settings.readerFont} onchange={saveSettings}>
          {#each Object.entries(READER_FONTS) as [value, font]}<option {value}>{font.label}</option>{/each}
        </select>
      </label>
      <label class="field">
        <span>Wortgröße: {app.settings.wordSize} px</span>
        <input type="range" min="28" max="96" step="2" bind:value={app.settings.wordSize} onchange={saveSettings} />
      </label>
      <label class="field">
        <span>Tempo für neue Bücher: {app.settings.defaultWpm} Wörter/min</span>
        <input type="range" min="100" max="900" step="10" bind:value={app.settings.defaultWpm} onchange={saveSettings} />
      </label>
    </div>
    <label class="check"><input type="checkbox" bind:checked={app.settings.guides} onchange={saveSettings} /> Hilfslinien an der Fixationsstelle</label>
  </section>

  <section>
    <h2>Leseprofile</h2>
    <p class="muted intro">
      Ein Profil ist ein Stapel von Scripts. Sie laufen von oben nach unten, spätere bauen auf dem Ergebnis der früheren auf.
    </p>
    <div class="profilebar">
      <select bind:value={editing} aria-label="Profil">
        {#each app.settings.profiles as p}<option value={p.id}>{p.name}</option>{/each}
      </select>
      <input type="text" bind:value={profile.name} onchange={saveSettings} aria-label="Name des Profils" />
      <button onclick={addProfile}>Duplizieren</button>
      <button class="danger" onclick={removeProfile} disabled={app.settings.profiles.length <= 1}>Löschen</button>
    </div>

    <ol class="stack">
      {#each profile.plugins as entry, index (entry.id)}
        {@const info = manifest(entry.id)}
        {#if info && !info.error}
          <li class:off={!entry.on}>
            <div class="row">
              <label class="check name">
                <input type="checkbox" bind:checked={entry.on} onchange={saveSettings} />
                <span>{info.name}</span>
              </label>
              <span class="hooks small muted">{info.hooks.map((h) => HOOK[h]).join(', ')}{entry.id.startsWith('local/') ? ', eigenes Script' : ''}</span>
              <span class="order">
                <button class="icon quiet" onclick={() => move(index, -1)} disabled={index === 0} aria-label="{info.name} nach oben">↑</button>
                <button class="icon quiet" onclick={() => move(index, 1)} disabled={index === profile.plugins.length - 1} aria-label="{info.name} nach unten">↓</button>
              </span>
            </div>
            {#if info.description}<p class="muted small">{info.description}</p>{/if}
            {#if entry.on && Object.keys(info.settings).length}
              <div class="grid options">
                {#each Object.entries(info.settings) as [key, field]}
                  {@const value = entry.settings?.[key] ?? field.default}
                  {#if field.type === 'boolean'}
                    <label class="check"><input type="checkbox" checked={value} onchange={(e) => setValue(entry, key, e.target.checked)} /> {field.label ?? key}</label>
                  {:else if field.type === 'select'}
                    <label class="field">
                      <span>{field.label ?? key}</span>
                      <select {value} onchange={(e) => setValue(entry, key, e.target.value)}>
                        {#each field.options ?? [] as option}<option value={option.value}>{option.label ?? option.value}</option>{/each}
                      </select>
                    </label>
                  {:else if field.type === 'number'}
                    <label class="field">
                      <span>{field.label ?? key}</span>
                      <input type="number" {value} min={field.min} max={field.max} step={field.step ?? 1} onchange={(e) => setValue(entry, key, Number(e.target.value))} />
                    </label>
                  {:else}
                    <label class="field">
                      <span>{field.label ?? key}</span>
                      <input type="text" {value} onchange={(e) => setValue(entry, key, e.target.value)} />
                    </label>
                  {/if}
                {/each}
              </div>
            {/if}
          </li>
        {/if}
      {/each}
    </ol>
  </section>

  <section>
    <h2>Eigene Scripts</h2>
    <p class="muted intro">
      Ein eigenes Script ist eine .js-Datei, wie sie in der Anleitung „Scripts schreiben“ beschrieben ist. Es bleibt in
      diesem Browser, wird nirgends hochgeladen und läuft ohne Zugriff auf das Netz. Nach einer Änderung an der Datei
      importierst du sie einfach noch einmal.
    </p>
    {#if scripts.length}
      <ul class="scripts">
        {#each scripts as script (script.id)}
          {@const info = manifest(script.id)}
          <li>
            <span>
              <b>{info && !info.error ? info.name : script.name}</b>
              <span class="muted small">{script.name}</span>
            </span>
            <button class="quiet danger small" onclick={() => dropScript(script)}>Entfernen</button>
          </li>
        {/each}
      </ul>
    {/if}
    {#each broken as plugin}
      <p class="error small"><code>{plugin.id}</code> lässt sich nicht laden: {plugin.error}</p>
    {/each}
    <button onclick={addScript}>Script importieren</button>
  </section>

  <section>
    <h2>Daten</h2>
    <p class="muted intro">
      Bücher, Lesestand und Einstellungen liegen nur in diesem Browser. Eine Sicherung enthält Einstellungen, eigene
      Scripts, Lesestände, Lesezeichen und Statistik, aber keine Bücher. Spielst du sie auf einem anderen Gerät ein und
      fügst dort dieselbe Datei hinzu, liest du an derselben Stelle weiter.
    </p>
    {#if usage}
      <p class="muted small usage">
        Belegt: {megabytes(usage.used)}{usage.quota ? ` von ${megabytes(usage.quota)}` : ''}.
        {usage.persisted ? 'Der Browser hält die Daten dauerhaft fest.' : 'Bei knappem Speicher darf der Browser die Daten löschen; eine Sicherung schützt davor.'}
      </p>
    {/if}
    <div class="buttons">
      <button onclick={backup}>Sicherung herunterladen</button>
      <button onclick={restore}>Sicherung einspielen</button>
    </div>
  </section>
</main>

<style>
  section {
    margin-bottom: 3rem;
  }
  h2 {
    font-size: var(--s1);
    margin-bottom: 1rem;
  }
  .intro {
    margin-bottom: 1rem;
    max-width: var(--measure);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
    gap: 0 1.5rem;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin-bottom: 0.6rem;
  }
  .profilebar {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }
  .profilebar input {
    flex: 1 1 10rem;
  }
  .stack {
    list-style: none;
    margin: 0;
    padding: 0;
    border-top: 1px solid var(--line);
  }
  .stack li {
    border-bottom: 1px solid var(--line);
    padding: 0.7rem 0;
  }
  .stack li.off .name span {
    color: var(--muted);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  .row .check {
    margin: 0;
    font-weight: 700;
  }
  .hooks {
    margin-left: auto;
    text-align: right;
  }
  .order {
    display: flex;
  }
  .stack p {
    margin: 0.15rem 0 0 1.7rem;
  }
  .options {
    margin: 0.75rem 0 0 1.7rem;
  }
  .options .field {
    margin-bottom: 0.5rem;
  }
  code {
    font-size: 0.9em;
  }
  .scripts {
    list-style: none;
    margin: 0 0 1rem;
    padding: 0;
    border-top: 1px solid var(--line);
  }
  .scripts li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.5rem 0;
    border-bottom: 1px solid var(--line);
  }
  .scripts li > span {
    display: grid;
  }
  .usage {
    margin-bottom: 1rem;
    max-width: var(--measure);
  }
  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
</style>
