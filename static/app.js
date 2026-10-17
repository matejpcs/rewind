const audio = document.querySelector('#audio');
const state = { tracks: [], albums: [], view: 'albums', filter: '', queue: [], queueIndex: -1, shuffle: false, repeat: 0, selectedAlbum: null, playlists: JSON.parse(localStorage.getItem('itunes-playlists') || '[]') };
const $ = (s) => document.querySelector(s);
const esc = (value = '') => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const mmss = value => `${Math.floor((value || 0) / 60)}:${String(Math.floor((value || 0) % 60)).padStart(2, '0')}`;
const totalDuration = tracks => tracks.reduce((sum, t) => sum + (t.duration || 0), 0);

async function loadLibrary() {
  $('#library-status').textContent = 'Scanning music…';
  try {
    const response = await fetch('/api/library');
    if (response.status === 401) { location.href = '/login'; return; }
    if (!response.ok) throw new Error('Could not load the library');
    const data = await response.json();
    state.tracks = data.tracks; state.albums = data.albums;
    $('#song-count').textContent = data.count;
    $('#album-count').textContent = data.albums.length;
    $('#status-count').textContent = `${data.count} ${data.count === 1 ? 'song' : 'songs'} · ${data.albums.length} ${data.albums.length === 1 ? 'album' : 'albums'}`;
    $('#status-size').textContent = data.count ? `${mmss(totalDuration(data.tracks))} of music` : 'A little music goes a long way';
    $('#library-status').textContent = data.count ? 'Library is up to date' : 'Your library is empty';
    $('#welcome').classList.toggle('hidden', data.count > 0);
    render();
  } catch (err) { $('#library-status').textContent = 'Could not connect'; toast(err.message); }
}

function matches(track) {
  const q = state.filter.toLocaleLowerCase();
  return !q || [track.title, track.artist, track.album_artist, track.album, track.genre, track.year].some(v => String(v || '').toLocaleLowerCase().includes(q));
}
function art(id, cls = '') { return `<div class="album-art ${cls}"><img loading="lazy" src="/artwork/${encodeURIComponent(id)}" alt="" onerror="this.remove()"><span>♫</span></div>`; }
function render() {
  const root = $('#content-view');
  let tracks = state.tracks.filter(matches);
  if (state.view === 'albums') {
    $('#view-title').textContent = state.selectedAlbum ? 'Album' : 'Albums';
    if (state.selectedAlbum) {
      const album = state.albums.find(a => a.id === state.selectedAlbum);
      if (!album) { state.selectedAlbum = null; render(); return; }
      const albumTracks = state.tracks.filter(t => album.tracks.includes(t.id));
      root.innerHTML = `<div class="album-detail"><button class="back-link" id="back-albums">‹ All Albums</button><div class="album-hero">${art(album.id, 'hero-art')}<div><div class="eyebrow">ALBUM</div><h1>${esc(album.album)}</h1><div class="album-by">${esc(album.artist)}${album.year ? ` · ${album.year}` : ''}</div><button class="blue-button" id="play-album">▶ Play Album</button></div></div>${table(albumTracks)}</div>`;
      $('#back-albums').onclick = () => { state.selectedAlbum = null; render(); };
      $('#play-album').onclick = () => playQueue(albumTracks, 0);
      bindRows(albumTracks);
    } else {
      const albums = state.albums.filter(a => state.tracks.some(t => a.tracks.includes(t.id) && matches(t)));
      root.innerHTML = albums.length ? `<div class="album-grid">${albums.map((a, i) => `<button class="album-card" data-album="${a.id}">${art(a.id, `cover-tone-${i % 6}`)}<span class="album-name">${esc(a.album)}</span><span class="album-artist">${esc(a.artist)}</span></button>`).join('')}</div>` : emptyResult();
      root.querySelectorAll('[data-album]').forEach(el => el.onclick = () => { state.selectedAlbum = el.dataset.album; render(); });
    }
  } else if (state.view === 'songs') {
    $('#view-title').textContent = 'Songs';
    root.innerHTML = tracks.length ? table(tracks) : emptyResult(); bindRows(tracks);
  } else if (state.view === 'artists') {
    $('#view-title').textContent = 'Artists';
    const byArtist = [...new Set(tracks.map(t => t.artist))].sort((a,b) => a.localeCompare(b));
    root.innerHTML = byArtist.length ? `<div class="artist-list">${byArtist.map((name, i) => { const group = tracks.filter(t => t.artist === name); return `<button class="artist-row" data-artist="${esc(name)}"><span class="artist-disc">${esc(name.slice(0,1).toUpperCase())}</span><span><strong>${esc(name)}</strong><small>${group.length} ${group.length === 1 ? 'song' : 'songs'} · ${new Set(group.map(t => t.album)).size} albums</small></span><span class="artist-arrow">›</span></button>`; }).join('')}</div>` : emptyResult();
    root.querySelectorAll('[data-artist]').forEach(el => el.onclick = () => { state.filter = el.dataset.artist; $('#search').value = state.filter; state.view = 'songs'; setActiveNav(); render(); });
  } else if (state.view === 'genres') {
    $('#view-title').textContent = 'Genres';
    const genres = [...new Set(tracks.map(t => t.genre))].sort((a,b) => a.localeCompare(b));
    root.innerHTML = genres.length ? `<div class="genre-grid">${genres.map((g, i) => `<button class="genre-tile genre-${i % 6}" data-genre="${esc(g)}"><span>${esc(g)}</span><small>${tracks.filter(t => t.genre === g).length} songs</small></button>`).join('')}</div>` : emptyResult();
    root.querySelectorAll('[data-genre]').forEach(el => el.onclick = () => { state.filter = el.dataset.genre; $('#search').value = state.filter; state.view = 'songs'; setActiveNav(); render(); });
  }
}
function emptyResult() { return `<div class="no-results"><span>⌕</span><strong>No matches</strong><small>Try another search.</small></div>`; }
function table(tracks) {
  return `<div class="song-table-wrap"><table class="song-table"><thead><tr><th class="number-col">#</th><th>NAME</th><th>ARTIST</th><th>ALBUM</th><th class="year-col">YEAR</th><th class="duration-col">TIME</th><th></th></tr></thead><tbody>${tracks.map((t, i) => `<tr data-track="${t.id}" tabindex="0"><td class="row-number"><span>${String(t.track || i + 1).padStart(2, '0')}</span><b>▶</b></td><td class="song-title"><span class="mini-art">${art(t.id)}</span><span>${esc(t.title)}</span></td><td>${esc(t.artist)}</td><td>${esc(t.album)}</td><td class="muted-cell">${t.year || '—'}</td><td class="muted-cell">${mmss(t.duration)}</td><td><button class="add-to-playlist" data-add-track="${t.id}" title="Add to playlist">＋</button></td></tr>`).join('')}</tbody></table></div>`;
}
function bindRows(tracks) {
  document.querySelectorAll('[data-track]').forEach(row => {
    const start = () => playQueue(tracks, tracks.findIndex(t => t.id === row.dataset.track));
    row.onclick = start; row.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); start(); } };
  });
  document.querySelectorAll('[data-add-track]').forEach(button => button.onclick = e => {
    e.stopPropagation();
    const track = tracks.find(t => t.id === button.dataset.addTrack); if (!track) return;
    if (!state.playlists.length) { const name = prompt('Create a playlist for this song'); if (!name?.trim()) return; state.playlists.push({ name: name.trim(), ids: [] }); }
    const choices = state.playlists.map((p, i) => `${i + 1}. ${p.name}`).join('\n');
    const choice = Number(prompt(`Add “${track.title}” to which playlist?\n${choices}\n\nEnter a number:`));
    const playlist = state.playlists[choice - 1];
    if (!playlist) { toast('No playlist selected'); return; }
    if (!playlist.ids.includes(track.id)) playlist.ids.push(track.id);
    localStorage.setItem('itunes-playlists', JSON.stringify(state.playlists)); renderPlaylists(); toast(`Added to “${playlist.name}”`);
  });
}
function playQueue(tracks, index) {
  if (!tracks.length || index < 0) return;
  state.queue = tracks; state.queueIndex = index;
  const track = tracks[index]; audio.src = `/stream/${encodeURIComponent(track.id)}`; audio.play().catch(() => toast('This audio format may not be supported by your browser.'));
  $('#playing-title').textContent = track.title; $('#playing-artist').textContent = `${track.artist}  ·  ${track.album}`;
  document.title = `${track.title} — Rewind`;
}
function advance(direction) {
  if (!state.queue.length) return;
  if (state.shuffle && direction > 0) state.queueIndex = Math.floor(Math.random() * state.queue.length);
  else state.queueIndex = (state.queueIndex + direction + state.queue.length) % state.queue.length;
  playQueue(state.queue, state.queueIndex);
}
function setActiveNav() {
  document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.view === state.view));
}
function toast(message) {
  const t = $('#toast'); t.textContent = message; t.classList.add('visible'); clearTimeout(toast.timer); toast.timer = setTimeout(() => t.classList.remove('visible'), 2800);
}
async function uploadFiles(files) {
  const form = new FormData(); [...files].forEach(file => form.append('files', file));
  $('#library-status').textContent = 'Adding your music…';
  try {
    const response = await fetch('/api/upload', { method: 'POST', body: form });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Upload failed');
    await loadLibrary();
    toast(result.uploaded ? `Added ${result.uploaded} ${result.uploaded === 1 ? 'song' : 'songs'} to your library` : 'No supported music files found');
    if (result.rejected?.length) toast(`${result.rejected.length} file(s) skipped: unsupported format`);
  } catch (err) { toast(err.message); $('#library-status').textContent = 'Upload failed'; }
  $('#file-input').value = '';
}

document.querySelectorAll('.nav-item').forEach(button => button.addEventListener('click', () => {
  state.view = button.dataset.view; state.selectedAlbum = null; state.filter = ''; $('#search').value = ''; setActiveNav(); render();
}));
$('#search').addEventListener('input', e => { state.filter = e.target.value; render(); });
$('#upload-button').onclick = $('#welcome-upload').onclick = () => $('#file-input').click();
$('#file-input').addEventListener('change', e => uploadFiles(e.target.files));
$('#refresh').onclick = $('#welcome-refresh').onclick = async () => { $('#library-status').textContent = 'Rescanning…'; await fetch('/api/scan', { method: 'POST' }); await loadLibrary(); toast('Library refreshed'); };
$('#play-toggle').onclick = () => { if (!state.queue.length && state.tracks.length) playQueue(state.tracks, 0); else if (audio.paused) audio.play(); else audio.pause(); };
$('#previous').onclick = () => { if (audio.currentTime > 3) audio.currentTime = 0; else advance(-1); };
$('#next').onclick = () => advance(1);
$('#shuffle').onclick = e => { state.shuffle = !state.shuffle; e.currentTarget.classList.toggle('pressed', state.shuffle); toast(state.shuffle ? 'Shuffle on' : 'Shuffle off'); };
$('#repeat').onclick = e => { state.repeat = (state.repeat + 1) % 3; e.currentTarget.classList.toggle('pressed', state.repeat > 0); e.currentTarget.title = ['Repeat off', 'Repeat all', 'Repeat song'][state.repeat]; toast(e.currentTarget.title); };
$('#volume').oninput = e => { audio.volume = Number(e.target.value); };
$('#seek').oninput = e => { if (audio.duration) audio.currentTime = Number(e.target.value) / 1000 * audio.duration; };
audio.volume = 0.8;
audio.ontimeupdate = () => { $('#elapsed').textContent = mmss(audio.currentTime); $('#seek').value = audio.duration ? Math.round(audio.currentTime / audio.duration * 1000) : 0; };
audio.onloadedmetadata = () => { $('#duration').textContent = mmss(audio.duration); };
audio.onplay = () => { $('#play-toggle').textContent = 'Ⅱ'; $('#play-toggle').title = 'Pause'; };
audio.onpause = () => { $('#play-toggle').textContent = '▶'; $('#play-toggle').title = 'Play'; };
audio.onended = () => { if (state.repeat === 2) { audio.currentTime = 0; audio.play(); } else if (state.repeat === 1 || state.queueIndex < state.queue.length - 1 || state.shuffle) advance(1); };
const overlay = $('#drop-overlay');
window.addEventListener('dragover', e => { e.preventDefault(); overlay.classList.remove('hidden'); });
overlay.addEventListener('dragleave', e => { if (!overlay.contains(e.relatedTarget)) overlay.classList.add('hidden'); });
overlay.addEventListener('drop', e => { e.preventDefault(); overlay.classList.add('hidden'); if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files); });
$('#new-playlist').onclick = () => {
  const name = prompt('Name your playlist'); if (!name?.trim()) return;
  state.playlists.push({ name: name.trim(), ids: [] }); localStorage.setItem('itunes-playlists', JSON.stringify(state.playlists)); renderPlaylists(); toast(`Created “${name.trim()}”`);
};
function renderPlaylists() {
  const root = $('#playlist-list');
  root.innerHTML = state.playlists.length ? state.playlists.map((p, i) => `<button class="nav-item playlist-item" data-playlist="${i}"><span class="nav-icon">♫</span>${esc(p.name)}<span class="nav-count">${p.ids.length}</span></button>`).join('') : '<div class="empty-playlists">Your playlists<br>will live here.</div>';
  root.querySelectorAll('[data-playlist]').forEach(el => el.onclick = () => { const p = state.playlists[Number(el.dataset.playlist)]; state.view = 'songs'; setActiveNav(); const selected = state.tracks.filter(t => p.ids.includes(t.id)); $('#view-title').textContent = p.name; $('#content-view').innerHTML = selected.length ? table(selected) : '<div class="no-results"><span>♫</span><strong>This playlist is ready</strong><small>Add songs from the library to fill it up.</small></div>'; bindRows(selected); });
}
renderPlaylists(); loadLibrary();
