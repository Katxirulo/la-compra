(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const cfg = window.APP_CONFIG || {};
  const LS = { hh: 'compra.hogar', name: 'compra.nombre' };

  if (!cfg.SUPABASE_URL || cfg.SUPABASE_URL.includes('TU-PROYECTO')) {
    document.getElementById('app').innerHTML =
      '<p style="padding:2rem 0">Falta configurar <code>config.js</code> con la URL y la clave de tu proyecto de Supabase.</p>';
    return;
  }

  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

  let household = load(LS.hh);
  let items = [];
  let favorites = [];
  let channel = null;
  let editingFavs = false;
  let refetchTimer = null;

  // ---------- utilidades ----------
  function load(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } }
  function forget(k) { try { localStorage.removeItem(k); } catch { /* nada */ } }
  const norm = (s) => s.trim().toLowerCase();

  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.remove('show'), 2200);
  }

  function show(view) {
    $('setup').hidden = view !== 'setup';
    $('main').hidden = view !== 'main';
  }

  async function ensureSession() {
    const { data } = await sb.auth.getSession();
    if (data.session) return data.session;
    const { data: d, error } = await sb.auth.signInAnonymously();
    if (error) throw error;
    return d.session;
  }

  // ---------- alta / unión ----------
  function showSetup(err) {
    show('setup');
    $('displayName').value = load(LS.name) || '';
    const code = new URLSearchParams(location.search).get('codigo');
    if (code) $('joinCode').value = code.toUpperCase();
    $('setupError').textContent = err || '';
  }

  function getName() {
    const n = $('displayName').value.trim();
    if (!n) {
      $('setupError').textContent = 'Escribe tu nombre para que los demás sepan quién apunta cada cosa.';
      $('displayName').focus();
      return null;
    }
    save(LS.name, n);
    return n;
  }

  $('joinForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = getName(); if (!name) return;
    const { data, error } = await sb.rpc('join_household', { p_code: $('joinCode').value, p_display_name: name });
    if (error) { $('setupError').textContent = 'No hay ninguna lista con ese código. Revísalo con quien te lo envió.'; return; }
    enter(data);
  });

  $('createForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = getName(); if (!name) return;
    const { data, error } = await sb.rpc('create_household', { p_name: $('householdName').value, p_display_name: name });
    if (error) { $('setupError').textContent = 'No se pudo crear la lista. Comprueba la conexión e inténtalo de nuevo.'; return; }
    enter(data);
    toast('Lista creada. Pulsa «Invitar» para compartirla.');
  });

  // ---------- pantalla principal ----------
  async function enter(h) {
    household = { id: h.id, name: h.name, code: h.code };
    save(LS.hh, household);
    if (location.search) history.replaceState(null, '', location.pathname);
    $('hhName').textContent = household.name;
    show('main');
    await Promise.all([fetchItems(), fetchFavs()]);
    subscribe();
  }

  async function fetchItems() {
    const { data, error } = await sb.from('items')
      .select('*').eq('household_id', household.id).order('created_at');
    if (!error) { items = data; renderItems(); renderFavs(); }
  }

  async function fetchFavs() {
    const { data, error } = await sb.from('favorites')
      .select('*').eq('household_id', household.id)
      .order('use_count', { ascending: false })
      .order('last_used', { ascending: false })
      .limit(30);
    if (!error) { favorites = data; renderFavs(); }
  }

  function scheduleRefetch() {
    clearTimeout(refetchTimer);
    refetchTimer = setTimeout(() => { fetchItems(); fetchFavs(); }, 150);
  }

  function subscribe() {
    if (channel) sb.removeChannel(channel);
    const filter = 'household_id=eq.' + household.id;
    channel = sb.channel('hogar-' + household.id)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'items', filter }, scheduleRefetch)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'items', filter }, scheduleRefetch)
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'items' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'favorites', filter }, scheduleRefetch)
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'favorites' }, scheduleRefetch)
      .subscribe((status) => {
        const ok = status === 'SUBSCRIBED';
        $('syncState').textContent = ok ? 'Sincronizado' : 'Reconectando…';
        $('syncState').classList.toggle('ok', ok);
      });
  }

  // ---------- acciones ----------
  async function addItem(name, qty) {
    name = name.trim();
    qty = (qty || '').trim() || null;
    if (!name) return;
    const dup = items.find((i) => !i.checked && norm(i.name) === norm(name));
    if (dup) { toast(`${dup.name} ya está en la lista`); return; }

    const temp = { id: 'tmp-' + Date.now(), household_id: household.id, name, qty, checked: false, added_by: load(LS.name), created_at: new Date().toISOString() };
    items.push(temp); renderItems(); renderFavs();

    const { error } = await sb.from('items').insert({ household_id: household.id, name, qty, added_by: load(LS.name) });
    if (error) {
      items = items.filter((i) => i !== temp); renderItems(); renderFavs();
      toast('No se pudo añadir. Comprueba la conexión.');
    } else {
      scheduleRefetch();
    }
  }

  async function toggle(item) {
    if (String(item.id).startsWith('tmp-')) return;
    item.checked = !item.checked; renderItems(); renderFavs();
    const { error } = await sb.from('items').update({ checked: item.checked }).eq('id', item.id);
    if (error) { item.checked = !item.checked; renderItems(); toast('No se pudo guardar el cambio.'); }
  }

  async function removeItem(item) {
    if (String(item.id).startsWith('tmp-')) return;
    items = items.filter((i) => i !== item); renderItems(); renderFavs();
    const { error } = await sb.from('items').delete().eq('id', item.id);
    if (error) { toast('No se pudo borrar.'); scheduleRefetch(); }
  }

  async function removeFav(fav) {
    favorites = favorites.filter((f) => f !== fav); renderFavs();
    const { error } = await sb.from('favorites').delete()
      .eq('household_id', household.id).eq('name_key', fav.name_key);
    if (error) { toast('No se pudo quitar de habituales.'); scheduleRefetch(); }
  }

  $('addForm').addEventListener('submit', (e) => {
    e.preventDefault();
    addItem($('itemName').value, $('itemQty').value);
    $('itemName').value = ''; $('itemQty').value = '';
    $('itemName').focus();
  });

  $('editFavs').addEventListener('click', () => {
    editingFavs = !editingFavs;
    $('editFavs').textContent = editingFavs ? 'Hecho' : 'Editar';
    renderFavs();
  });

  $('clearDone').addEventListener('click', async () => {
    const done = items.filter((i) => i.checked);
    if (!done.length) return;
    items = items.filter((i) => !i.checked); renderItems(); renderFavs();
    const { error } = await sb.from('items').delete().eq('household_id', household.id).eq('checked', true);
    if (error) { toast('No se pudieron quitar los comprados.'); scheduleRefetch(); }
    else toast(`${done.length} ${done.length === 1 ? 'producto quitado' : 'productos quitados'}`);
  });

  $('inviteBtn').addEventListener('click', async () => {
    const url = `${location.origin}${location.pathname}?codigo=${household.code}`;
    const text = `Únete a la lista de la compra «${household.name}». Código: ${household.code}`;
    if (navigator.share) {
      try { await navigator.share({ title: 'La compra', text, url }); } catch { /* cancelado */ }
    } else {
      try { await navigator.clipboard.writeText(`${text}\n${url}`); toast('Enlace copiado'); }
      catch { toast(`Código: ${household.code}`); }
    }
  });

  $('leaveBtn').addEventListener('click', () => {
    if (!confirm('¿Cambiar de lista? Podrás volver a entrar con el código de invitación.')) return;
    if (channel) sb.removeChannel(channel);
    channel = null; household = null; items = []; favorites = [];
    forget(LS.hh);
    showSetup();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && household) scheduleRefetch();
  });

  // ---------- render ----------
  function itemRow(i) {
    const li = document.createElement('li');

    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'item';
    b.setAttribute('aria-pressed', String(i.checked));

    const box = document.createElement('span'); box.className = 'box'; box.setAttribute('aria-hidden', 'true');
    const name = document.createElement('span'); name.className = 'name'; name.textContent = i.name;
    b.append(box, name);
    if (i.qty) { const q = document.createElement('span'); q.className = 'qty-tag'; q.textContent = i.qty; b.append(q); }
    if (i.added_by) { const w = document.createElement('span'); w.className = 'who'; w.textContent = i.added_by; b.append(w); }
    b.addEventListener('click', () => toggle(i));

    const del = document.createElement('button');
    del.type = 'button'; del.className = 'del'; del.textContent = '×';
    del.setAttribute('aria-label', 'Borrar ' + i.name);
    del.addEventListener('click', () => removeItem(i));

    li.append(b, del);
    return li;
  }

  function renderItems() {
    const pending = items.filter((i) => !i.checked);
    const done = items.filter((i) => i.checked);
    $('pendingList').replaceChildren(...pending.map(itemRow));
    $('doneList').replaceChildren(...done.map(itemRow));
    $('pendingCount').textContent = pending.length ? `(${pending.length})` : '';
    $('doneCount').textContent = done.length ? `(${done.length})` : '';
    $('pendingEmpty').hidden = pending.length > 0;
    $('doneSection').hidden = done.length === 0;
  }

  function renderFavs() {
    const onList = new Set(items.filter((i) => !i.checked).map((i) => norm(i.name)));
    const list = $('favList');
    list.classList.toggle('editing', editingFavs);
    list.replaceChildren(...favorites.map((f) => {
      const c = document.createElement('button');
      c.type = 'button';
      c.className = 'chip';
      const inList = onList.has(f.name_key);
      if (inList && !editingFavs) c.classList.add('on-list');
      c.append(document.createTextNode(f.name));
      if (editingFavs) {
        const x = document.createElement('span'); x.className = 'x'; x.textContent = '×'; x.setAttribute('aria-hidden', 'true');
        c.append(x);
        c.setAttribute('aria-label', 'Quitar ' + f.name + ' de habituales');
        c.addEventListener('click', () => removeFav(f));
      } else {
        c.setAttribute('aria-label', inList ? f.name + ', ya en la lista' : 'Añadir ' + f.name);
        c.addEventListener('click', () => addItem(f.name));
      }
      return c;
    }));
    $('favEmpty').hidden = favorites.length > 0;
    $('editFavs').hidden = favorites.length === 0 && !editingFavs;
  }

  // ---------- arranque ----------
  async function init() {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
    try {
      await ensureSession();
    } catch {
      showSetup('No se pudo conectar. Comprueba que el acceso anónimo está activado en Supabase.');
      return;
    }
    if (household) {
      const { data, error } = await sb.from('households').select('id,name,code').eq('id', household.id).maybeSingle();
      if (data) { enter(data); return; }
      if (error) { enter(household); return; }   // sin conexión: usa la copia local
      forget(LS.hh); household = null;
    }
    showSetup();
  }

  init();
})();
