<script>
  import { api } from '../lib/api.js';
  import { app, refreshState } from '../lib/state.svelte.js';

  let name = $state('');
  let password = $state('');
  let repeat = $state('');
  let error = $state('');
  let busy = $state(false);

  async function submit(event) {
    event.preventDefault();
    error = '';
    if (app.setupNeeded && password !== repeat) {
      error = 'Die beiden Passwörter stimmen nicht überein.';
      return;
    }
    busy = true;
    try {
      await api.post(app.setupNeeded ? '/api/setup' : '/api/login', { name, password });
      await refreshState();
    } catch (failure) {
      error = failure.status === 422 ? 'Das Passwort braucht mindestens 8 Zeichen.' : failure.message;
    }
    busy = false;
  }
</script>

<main class="gate">
  <div class="mark" aria-hidden="true"><i></i><b></b><i></i></div>
  <h1>Wortlauf</h1>
  <p class="muted lead">
    {app.setupNeeded ? 'Lege dein Konto an. Es gibt genau eines auf diesem Server.' : 'Melde dich an, um weiterzulesen.'}
  </p>

  <form onsubmit={submit}>
    <label class="field">
      <span>Name</span>
      <input type="text" bind:value={name} autocomplete="username" required />
    </label>
    <label class="field">
      <span>Passwort{app.setupNeeded ? ' (mindestens 8 Zeichen)' : ''}</span>
      <input type="password" bind:value={password} autocomplete={app.setupNeeded ? 'new-password' : 'current-password'} required />
    </label>
    {#if app.setupNeeded}
      <label class="field">
        <span>Passwort wiederholen</span>
        <input type="password" bind:value={repeat} autocomplete="new-password" required />
      </label>
    {/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <button class="primary" disabled={busy}>{app.setupNeeded ? 'Konto anlegen' : 'Anmelden'}</button>
  </form>
</main>

<style>
  .gate {
    max-width: 22rem;
    margin: 0 auto;
    padding: 14vh 1rem 2rem;
  }
  .mark {
    display: grid;
    justify-items: center;
    gap: 6px;
    width: 4.5rem;
    margin-bottom: 1.5rem;
  }
  .mark i {
    width: 2px;
    height: 12px;
    background: var(--accent);
  }
  .mark b {
    width: 100%;
    height: 8px;
    border-radius: 4px;
    background: var(--text);
  }
  .lead {
    margin: 0.5rem 0 2rem;
  }
  form {
    display: grid;
  }
  .error {
    margin-bottom: 1rem;
  }
  button {
    justify-self: start;
  }
</style>
