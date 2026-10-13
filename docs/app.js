// Détective du Web — nom de domaine → adresse IP → pays du serveur.
// Aucune bibliothèque : les données sont chargées par data/*.js avant ce fichier.
(function () {
  'use strict';

  // =========================================================================
  // Réglages
  // =========================================================================

  const DELAI_DNS_MS = 4000; // au-delà, on passe à l'annuaire suivant
  const CLE_STOCKAGE = 'detective-du-web-v1';

  const SUGGESTIONS = ['alibaba.com', 'tiktok.com', 'roblox.com', 'wikipedia.org',
    'laposte.fr', 'yandex.ru', 'twitch.tv', 'naver.com'];

  // Les annuaires en ligne (DNS-over-HTTPS), essayés dans l'ordre.
  const ANNUAIRES = [
    {
      nom: 'Google Public DNS',
      url: (d) => 'https://dns.google/resolve?type=A&name=' + encodeURIComponent(d),
      options: {},
    },
    {
      nom: 'Cloudflare',
      url: (d) => 'https://cloudflare-dns.com/dns-query?type=A&name=' + encodeURIComponent(d),
      options: { headers: { accept: 'application/dns-json' } },
    },
  ];

  const CONTINENTS = {
    AF: 'Afrique', NA: 'Amérique du Nord', SA: 'Amérique du Sud',
    AS: 'Asie', EU: 'Europe', OC: 'Océanie', AN: 'Antarctique',
  };
  const CHOIX_PARI = ['AF', 'NA', 'SA', 'AS', 'EU', 'OC'];

  const DEFIS = [
    { id: 'alibaba', texte: 'Trouve le pays du serveur de alibaba.com', points: 10 },
    { id: 'france', texte: 'Trouve un site dont le serveur est en France', points: 15 },
    { id: 'plusieurs', texte: 'Trouve un site qui a plusieurs adresses IP', points: 10 },
    { id: 'loin', texte: 'Trouve un serveur à plus de 10 000 km de Hong Kong', points: 15 },
    { id: 'continents', texte: 'Tamponne ton passeport sur 3 continents différents', points: 20 },
    { id: 'privee', texte: 'Teste une adresse IP privée (indice : elle commence par 192.168)', points: 10 },
    { id: 'parieur', texte: 'Gagne 3 paris', points: 15 },
  ];

  // Hébergeurs « anycast » : la même IP répond depuis des centaines de villes,
  // le pays de la base n'est donc que le pays d'enregistrement.
  const HEBERGEURS_PARTOUT = [
    { nom: 'Cloudflare', villes: 'plus de 300 villes', plages: ['104.16.0.0/13', '104.24.0.0/14', '172.64.0.0/13',
      '162.158.0.0/15', '141.101.64.0/18', '188.114.96.0/20', '190.93.240.0/20', '197.234.240.0/22',
      '198.41.128.0/17', '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22',
      '108.162.192.0/18', '131.0.72.0/22'] },
    { nom: 'Fastly', villes: 'une centaine de villes', plages: ['151.101.0.0/16', '146.75.0.0/17'] },
  ];

  // Extensions de pays utilisées pour autre chose que leur pays
  const EXTENSIONS_DETOURNEES = {
    tv: 'Tuvalu, un petit pays d\'îles du Pacifique, qui loue son extension .tv aux sites de vidéo !',
    ai: 'Anguilla, une île des Caraïbes, très demandée par les sites d\'intelligence artificielle.',
    io: 'le Territoire britannique de l\'océan Indien, adoptée par les sites d\'informatique (« input/output »).',
    me: 'le Monténégro, utilisée pour des sites personnels (« me » = « moi » en anglais).',
    co: 'la Colombie, utilisée comme un raccourci de « company ».',
  };

  // =========================================================================
  // Petits outils
  // =========================================================================

  const $ = (id) => document.getElementById(id);

  function echapper(texte) {
    return String(texte).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  let nomsRegions = null;
  try { nomsRegions = new Intl.DisplayNames(['fr'], { type: 'region' }); } catch (e) { /* vieux navigateur */ }

  function nomPays(code) {
    if (code === 'HK') return 'Hong Kong';
    try {
      const nom = nomsRegions && nomsRegions.of(code);
      if (nom && nom !== code) return nom;
    } catch (e) { /* code inconnu */ }
    return 'Pays ' + code;
  }

  // Les drapeaux emoji n'existent pas sous Windows : on vérifie qu'ils s'affichent en couleur.
  const drapeauxDisponibles = (function () {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 32;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.font = '28px sans-serif';
      ctx.textBaseline = 'top';
      ctx.fillText('\u{1F1EB}\u{1F1F7}', 0, 0);
      const px = ctx.getImageData(0, 0, 32, 32).data;
      for (let i = 0; i < px.length; i += 4) {
        if (px[i + 3] > 0 && (Math.abs(px[i] - px[i + 1]) > 40 || Math.abs(px[i + 1] - px[i + 2]) > 40)) return true;
      }
    } catch (e) { /* canvas indisponible */ }
    return false;
  })();

  function drapeau(code) {
    if (!/^[A-Z]{2}$/.test(code)) return '🏳️';
    return String.fromCodePoint(...[...code].map((c) => 0x1F1E6 + c.charCodeAt(0) - 65));
  }

  function htmlDrapeau(code, grand) {
    if (drapeauxDisponibles) return `<span class="${grand ? 'drapeau' : ''}" aria-hidden="true">${drapeau(code)}</span>`;
    return grand ? `<span class="drapeau-code" aria-hidden="true">${echapper(code)}</span>` : echapper(code);
  }

  function formaterKm(km) {
    return Math.round(km / 100) * 100 >= 1000
      ? (Math.round(km / 100) * 100).toLocaleString('fr-FR') + ' km'
      : Math.round(km) + ' km';
  }

  function distanceKm([lon1, lat1], [lon2, lat2]) {
    const rad = Math.PI / 180;
    const a = Math.sin((lat2 - lat1) * rad / 2) ** 2 +
      Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin((lon2 - lon1) * rad / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.sqrt(a));
  }

  // =========================================================================
  // Base IP → pays (décodée une seule fois au chargement)
  // =========================================================================

  const baseIP = (function () {
    const brut = atob(window.IP_PAYS.donnees);
    const n = window.IP_PAYS.nombre;
    const debuts = new Uint32Array(n);
    const pays = new Uint8Array(n);
    let pos = 0;
    let debut = 0;
    for (let i = 0; i < n; i++) {
      let ecart = 0;
      let multiplicateur = 1;
      let octet;
      do {
        octet = brut.charCodeAt(pos++);
        ecart += (octet & 127) * multiplicateur;
        multiplicateur *= 128;
      } while (octet & 128);
      debut += ecart;
      debuts[i] = debut;
      pays[i] = brut.charCodeAt(pos++);
    }
    return { debuts, pays, codes: window.IP_PAYS.codes };
  })();

  function paysDeIP(entier) {
    // recherche dichotomique de la dernière plage qui commence avant l'IP
    let bas = 0;
    let haut = baseIP.debuts.length - 1;
    while (bas < haut) {
      const milieu = (bas + haut + 1) >> 1;
      if (baseIP.debuts[milieu] <= entier) bas = milieu; else haut = milieu - 1;
    }
    const i = baseIP.pays[bas] * 2;
    return baseIP.codes.slice(i, i + 2);
  }

  // =========================================================================
  // Analyse d'une adresse IP tapée par l'élève
  // =========================================================================

  function analyserIP(texte) {
    const propre = texte.trim().replace(/\s+/g, '');
    if (propre.includes(':')) return { ok: false, ipv6: true };
    const morceaux = propre.split('.');
    const octets = morceaux.map((m) => ({
      texte: m,
      valeur: /^\d{1,3}$/.test(m) ? Number(m) : NaN,
    }));
    octets.forEach((o) => { o.faux = !(o.valeur >= 0 && o.valeur <= 255); });

    if (morceaux.length !== 4) {
      return { ok: false, octets, erreur: `Une adresse IP contient exactement <strong>4 nombres</strong> séparés par des points. Ici, il y en a ${morceaux.length}.` };
    }
    if (octets.some((o) => o.faux)) {
      return { ok: false, octets, erreur: 'Chaque nombre d\'une adresse IP est compris entre <strong>0 et 255</strong>. Les nombres en rouge ne vont pas.' };
    }
    const [a, b] = octets.map((o) => o.valeur);
    let type = 'publique';
    if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) type = 'privee';
    else if (a === 127) type = 'locale';
    else if (a === 0 || a >= 224 || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127)) type = 'speciale';

    const entier = octets.reduce((acc, o) => acc * 256 + o.valeur, 0);
    return { ok: true, octets, type, entier, texte: octets.map((o) => o.valeur).join('.') };
  }

  function htmlDecomposition(octets) {
    return '<div class="decomposition" aria-hidden="true">' + octets.map((o, i) =>
      (i ? '<span class="point-ip">.</span>' : '') +
      `<span class="octet o${i + 1}${o.faux ? ' faux' : ''}"><b>${echapper(o.texte || '?')}</b><small>0 à 255</small></span>`
    ).join('') + '</div>';
  }

  // =========================================================================
  // DNS : annuaires en ligne, puis liste de secours
  // =========================================================================

  let modeSecours = false;

  function nettoyerDomaine(texte) {
    let d = texte.trim().toLowerCase().replace(/^[a-z]+:\/\//, '').split(/[/?#\s]/)[0];
    if (d.includes('@')) d = d.split('@').pop(); // une adresse mail → son domaine
    try { d = new URL('http://' + d).hostname; } catch (e) { return null; } // gère les accents
    return d.replace(/\.$/, '') || null;
  }

  async function interrogerAnnuaire(annuaire, domaine) {
    const controleur = new AbortController();
    const minuterie = setTimeout(() => controleur.abort(), DELAI_DNS_MS);
    try {
      const reponse = await fetch(annuaire.url(domaine), { ...annuaire.options, signal: controleur.signal });
      if (!reponse.ok) throw new Error('HTTP ' + reponse.status);
      const json = await reponse.json();
      if (typeof json.Status !== 'number') throw new Error('Réponse inattendue');
      const enregistrements = json.Answer || [];
      return {
        statut: json.Status,
        alias: enregistrements.filter((r) => r.type === 5).map((r) => r.data.replace(/\.$/, '')),
        ips: enregistrements.filter((r) => r.type === 1).map((r) => r.data),
        source: annuaire.nom,
      };
    } finally {
      clearTimeout(minuterie);
    }
  }

  async function resoudreEnLigne(domaine) {
    for (const annuaire of ANNUAIRES) {
      try { return await interrogerAnnuaire(annuaire, domaine); } catch (e) { /* annuaire suivant */ }
    }
    return null;
  }

  function resoudreSecours(domaine) {
    const liste = window.HORS_LIGNE.domaines;
    const variantes = [domaine, 'www.' + domaine, domaine.replace(/^www\./, '')];
    for (const v of variantes) {
      if (liste[v]) return { statut: 0, ...liste[v], source: 'secours', domaine: v };
    }
    return null;
  }

  function activerModeSecours(actif) {
    modeSecours = actif;
    $('bandeau-secours').hidden = !actif;
  }

  async function resoudre(domaine) {
    // En mode secours, la liste enregistrée répond tout de suite.
    if (modeSecours) {
      const secours = resoudreSecours(domaine);
      if (secours) return secours;
    }
    let r = await resoudreEnLigne(domaine);
    if (!r) {
      activerModeSecours(true);
      return resoudreSecours(domaine) || { statut: 'secours-introuvable' };
    }
    activerModeSecours(false);
    r.domaine = domaine;
    // Certains sites (gov.hk…) ne répondent qu'avec « www. » devant.
    if (r.statut === 0 && r.ips.length === 0 && !domaine.startsWith('www.')) {
      const avecWww = await resoudreEnLigne('www.' + domaine);
      if (avecWww && avecWww.ips.length) return { ...avecWww, domaine: 'www.' + domaine };
    }
    return r;
  }

  // =========================================================================
  // Carnet (points, passeport, défis, historique) — gardé dans le navigateur
  // =========================================================================

  function etatVide() {
    return { points: 0, tampons: [], defis: [], parisGagnes: 0, historique: [] };
  }

  let etat = etatVide();
  try {
    const sauve = JSON.parse(localStorage.getItem(CLE_STOCKAGE));
    if (sauve && typeof sauve.points === 'number') etat = { ...etatVide(), ...sauve };
  } catch (e) { /* stockage indisponible : carnet non conservé */ }

  function sauvegarder() {
    try { localStorage.setItem(CLE_STOCKAGE, JSON.stringify(etat)); } catch (e) { /* tant pis */ }
  }

  // Les gains arrivant ensemble (pari + tampon + défi) s'affichent l'un après l'autre.
  let scoreAffiche = etat.points;
  let gainsEnAttente = 0;

  function ajouterPoints(n, icone) {
    if (!n) return;
    etat.points += n;
    const delai = gainsEnAttente++ * 450;
    setTimeout(() => { gainsEnAttente--; animerGain(n, icone); }, delai);
  }

  function animerGain(n, icone) {
    const boite = $('boite-score');
    const bulle = document.createElement('span');
    bulle.className = 'bulle-gain';
    bulle.textContent = '+' + n + (icone ? ' ' + icone : '');
    bulle.addEventListener('animationend', () => bulle.remove());
    setTimeout(() => bulle.remove(), 2000); // au cas où l'animation est désactivée
    boite.appendChild(bulle);

    // le compteur défile jusqu'à la nouvelle valeur
    const depart = scoreAffiche;
    const arrivee = scoreAffiche + n;
    scoreAffiche = arrivee;
    const debut = performance.now();
    const pas = (t) => {
      const avancement = Math.min(1, (t - debut) / 600);
      $('score').textContent = Math.round(depart + (arrivee - depart) * avancement);
      if (avancement < 1) requestAnimationFrame(pas);
    };
    requestAnimationFrame(pas);
    setTimeout(() => { $('score').textContent = Math.max(arrivee, Number($('score').textContent)); }, 700);

    boite.classList.remove('bonus');
    void boite.offsetWidth; // relance l'animation
    boite.classList.add('bonus');
  }

  function reussirDefi(id) {
    if (etat.defis.includes(id)) return;
    etat.defis.push(id);
    const defi = DEFIS.find((d) => d.id === id);
    ajouterPoints(defi.points, '🏆');
    afficherDefis(id);
  }

  function afficherDefis(nouveau) {
    $('defis').innerHTML = DEFIS.map((d) => {
      const classes = [etat.defis.includes(d.id) ? 'reussi' : '', d.id === nouveau ? 'vient-de-reussir' : ''].join(' ');
      return `<li class="${classes}">${echapper(d.texte)}<span class="points">+${d.points} pts</span></li>`;
    }).join('');
  }

  function afficherTampons(nouveau) {
    const conteneur = $('tampons');
    $('compteur-tampons').textContent = etat.tampons.length
      ? `(${etat.tampons.length} pays, ${continentsVisites().size} continent${continentsVisites().size > 1 ? 's' : ''})` : '';
    if (!etat.tampons.length) {
      conteneur.innerHTML = '<p class="vide">Aucun tampon pour l\'instant : localise ton premier serveur !</p>';
      return;
    }
    conteneur.innerHTML = etat.tampons.map((code, i) => {
      const angle = ((i * 37) % 25) - 12;
      return `<div class="tampon${code === nouveau ? ' nouveau' : ''}" style="--angle:${angle}deg" title="${echapper(nomPays(code))}">
        <span>${htmlDrapeau(code, false)}</span>${echapper(nomPays(code))}</div>`;
    }).join('');
  }

  function continentsVisites() {
    return new Set(etat.tampons.map((c) => window.CARTE.continents[c]).filter(Boolean));
  }

  function afficherHistorique() {
    const corps = $('historique');
    if (!etat.historique.length) {
      corps.innerHTML = '<tr class="vide"><td colspan="3">Rien pour l\'instant.</td></tr>';
      return;
    }
    corps.innerHTML = etat.historique.slice().reverse().map((h) =>
      `<tr><td>${echapper(h.domaine || '—')}</td><td>${echapper(h.ip)}</td>` +
      `<td>${htmlDrapeau(h.code, false)} ${echapper(nomPays(h.code))}</td></tr>`
    ).join('');
  }

  // =========================================================================
  // Carte du monde
  // =========================================================================

  const SVG = 'http://www.w3.org/2000/svg';
  const C = window.CARTE;

  function creerSvg(nom, attributs) {
    const el = document.createElementNS(SVG, nom);
    for (const [k, v] of Object.entries(attributs || {})) el.setAttribute(k, v);
    return el;
  }

  function dessinerCarte() {
    const svg = $('carte');
    svg.setAttribute('viewBox', `0 0 ${C.largeur} ${C.hauteur}`);
    svg.appendChild(creerSvg('path', { d: C.contour, class: 'contour-mer' }));
    const groupePays = creerSvg('g');
    for (const [code, d] of Object.entries(C.formes)) {
      const p = creerSvg('path', { d, class: 'pays', 'data-code': code });
      const titre = creerSvg('title');
      titre.textContent = nomPays(code);
      p.appendChild(titre);
      groupePays.appendChild(p);
    }
    for (const d of C.sansCode) groupePays.appendChild(creerSvg('path', { d, class: 'pays' }));
    svg.appendChild(groupePays);
    svg.appendChild(creerSvg('g', { id: 'calque-trajet' }));
    const [x, y] = C.depart.xy;
    svg.appendChild(creerSvg('circle', { cx: x, cy: y, r: 6, class: 'depart-halo' }));
    svg.appendChild(creerSvg('circle', { cx: x, cy: y, r: 6, class: 'depart' }));
    colorierPaysVisites();
  }

  function colorierPaysVisites() {
    document.querySelectorAll('#carte .pays[data-code]').forEach((p) => {
      p.classList.toggle('visite', etat.tampons.includes(p.dataset.code));
    });
  }

  function afficherTrajet(code) {
    const calque = $('calque-trajet');
    calque.innerHTML = '';
    document.querySelectorAll('#carte .pays.vise').forEach((p) => p.classList.remove('vise'));
    const forme = document.querySelector(`#carte .pays[data-code="${code}"]`);
    if (forme) forme.classList.add('vise');

    const centre = C.centres[code];
    if (!centre) return;
    const [x1, y1] = C.depart.xy;
    const [x2, y2] = centre;
    const longueur = Math.hypot(x2 - x1, y2 - y1);

    if (longueur > 8) {
      // arc courbé vers le haut, dessiné progressivement
      const cx = (x1 + x2) / 2;
      const cy = Math.min(y1, y2) - longueur * 0.3;
      const arc = creerSvg('path', { d: `M${x1},${y1} Q${cx},${cy} ${x2},${y2}`, class: 'trajet' });
      calque.appendChild(arc);
      const total = arc.getTotalLength();
      arc.style.strokeDasharray = total;
      arc.style.strokeDashoffset = total;
      arc.getBoundingClientRect(); // force le navigateur à prendre l'état de départ
      arc.style.transition = 'stroke-dashoffset 1s ease-in-out';
      arc.style.strokeDashoffset = 0;
    }
    // épingle (pointe en bas, posée sur le pays)
    const epingle = creerSvg('g', { class: 'epingle' });
    epingle.appendChild(creerSvg('path', {
      d: `M${x2},${y2} c-3,-8 -10,-12 -10,-20 a10,10 0 1 1 20,0 c0,8 -7,12 -10,20 z`,
      fill: '#e8590c', stroke: '#fff', 'stroke-width': 2,
    }));
    epingle.appendChild(creerSvg('circle', { cx: x2, cy: y2 - 20, r: 4, fill: '#fff' }));
    calque.appendChild(epingle);
  }

  // =========================================================================
  // Étape 1 : chercher l'IP d'un domaine
  // =========================================================================

  let domaineCourant = null; // pour relier une IP à son site dans le carnet
  let ipsDuDomaine = [];

  function htmlListeSecours() {
    return '<div class="suggestions">' + Object.keys(window.HORS_LIGNE.domaines).map((d) =>
      `<button type="button" class="puce" data-domaine="${echapper(d)}">${echapper(d)}</button>`).join('') + '</div>';
  }

  async function chercherDomaine(texte) {
    const zone = $('resultat-dns');
    const bouton = document.querySelector('#form-dns button');
    const domaine = nettoyerDomaine(texte);

    if (!domaine) {
      zone.innerHTML = '<p class="message erreur">Ce nom de domaine contient des caractères impossibles. Exemple de nom valide : <strong>wikipedia.org</strong></p>';
      return;
    }
    if (analyserIP(domaine).ok) {
      zone.innerHTML = '<p class="message info">C\'est déjà une adresse IP ! Je l\'ai recopiée à l\'étape 2 👇</p>';
      $('saisie-ip').value = domaine;
      $('saisie-ip').focus();
      return;
    }
    if (!domaine.includes('.')) {
      zone.innerHTML = `<p class="message erreur">Il manque l'extension : <strong>${echapper(domaine)}.com</strong>, <strong>${echapper(domaine)}.fr</strong>… ?</p>`;
      return;
    }

    bouton.disabled = true;
    zone.innerHTML = `<p class="message">📖 Je consulte l'annuaire pour <strong>${echapper(domaine)}</strong>…</p>`;
    let r;
    try {
      r = await resoudre(domaine);
    } finally {
      bouton.disabled = false;
    }

    if (r.statut === 'secours-introuvable') {
      zone.innerHTML = '<p class="message erreur">Le réseau bloque l\'annuaire en ligne et ce site n\'est pas dans ma liste de secours. Choisis-en un ici :</p>' + htmlListeSecours();
      return;
    }
    if (r.statut === 3) {
      zone.innerHTML = `<p class="message erreur">❓ <strong>${echapper(domaine)}</strong> n'existe pas dans l'annuaire. Vérifie l'orthographe !</p>`;
      return;
    }
    if (r.statut !== 0 || r.ips.length === 0) {
      zone.innerHTML = `<p class="message erreur">L'annuaire n'a pas trouvé d'adresse IPv4 pour <strong>${echapper(domaine)}</strong>. Essaie un autre site.</p>`;
      return;
    }

    domaineCourant = r.domaine;
    ipsDuDomaine = r.ips;
    let delai = 0;
    const etapes = () => `style="animation-delay:${(delai++) * 0.25}s"`;
    const chaine = [`<span class="maillon" ${etapes()}><small>Nom de domaine</small>${echapper(r.domaine)}</span>`];
    for (const alias of r.alias) {
      chaine.push(`<span class="fleche" ${etapes()}>→</span>`,
        `<span class="maillon" ${etapes()}><small>Alias (autre nom)</small>${echapper(alias)}</span>`);
    }
    chaine.push(`<span class="fleche" ${etapes()}>→</span>`,
      `<span class="maillon" ${etapes()}><small>Résultat</small>Adresse${r.ips.length > 1 ? 's' : ''} IP 👇</span>`);

    const pluriel = r.ips.length > 1;
    zone.innerHTML =
      `<div class="chaine-dns">${chaine.join('')}</div>` +
      `<p class="message succes">🎉 ${pluriel ? `<strong>${r.ips.length} adresses IP</strong> trouvées` : 'Adresse IP trouvée'} ! Clique ${pluriel ? 'sur l\'une d\'elles' : 'dessus'} pour localiser le serveur.</p>` +
      '<div class="ips">' + r.ips.map((ip) =>
        `<button type="button" class="bouton-ip" data-ip="${echapper(ip)}" ${etapes()}>${echapper(ip)}</button>`).join('') + '</div>' +
      (pluriel ? '<p class="savais-tu"><strong>Le savais-tu ?</strong> Un site très visité utilise plusieurs serveurs en même temps pour se partager le travail.</p>' : '') +
      (r.alias.length ? '<p class="savais-tu"><strong>Alias :</strong> l\'annuaire a d\'abord renvoyé un autre nom avant de donner l\'adresse IP. Souvent, c\'est le nom de l\'entreprise qui héberge vraiment le site.</p>' : '') +
      `<p class="source">${r.source === 'secours'
        ? `🛟 Réponse de la liste de secours (enregistrée le ${new Date(window.HORS_LIGNE.date).toLocaleDateString('fr-FR')}).`
        : `📖 Réponse de l'annuaire ${echapper(r.source)}.`}</p>`;

    if (pluriel) reussirDefi('plusieurs');
    sauvegarder();
  }

  // =========================================================================
  // Étape 2 : localiser une IP (avec pari)
  // =========================================================================

  let enAttente = null; // { ip, code, domaine } en attente du pari

  function localiser(texte, domaine) {
    const zone = $('resultat-ip');
    $('pari').hidden = true;
    enAttente = null;
    const a = analyserIP(texte);

    if (!a.ok) {
      zone.innerHTML = a.ipv6
        ? '<p class="message info">C\'est une adresse <strong>IPv6</strong> (la nouvelle génération, avec des « : »). Ici, on travaille avec les adresses <strong>IPv4</strong> : 4 nombres séparés par des points.</p>'
        : htmlDecomposition(a.octets) + `<p class="message erreur">${a.erreur}</p>`;
      return;
    }

    const decomposition = htmlDecomposition(a.octets);
    if (a.type === 'privee') {
      zone.innerHTML = decomposition +
        '<p class="message info">🏠 <strong>Adresse IP privée !</strong> Elle n\'existe qu\'à l\'intérieur d\'un réseau local (ta maison, le collège). Des millions de réseaux utilisent les mêmes : elle ne peut donc pas être localisée sur Internet. C\'est la <em>box</em> ou le routeur qui fait le lien avec Internet.</p>';
      reussirDefi('privee');
      sauvegarder();
      return;
    }
    if (a.type === 'locale') {
      zone.innerHTML = decomposition +
        '<p class="message info">🪞 Les adresses qui commencent par <strong>127</strong> désignent… ton propre ordinateur ! Un message envoyé là ne sort jamais de la machine.</p>';
      return;
    }
    if (a.type === 'speciale') {
      zone.innerHTML = decomposition +
        '<p class="message info">🚧 Cette adresse est <strong>réservée</strong> à un usage spécial : elle n\'appartient à aucun serveur d\'Internet.</p>';
      return;
    }

    const code = paysDeIP(a.entier);
    if (code === 'ZZ' || !C.continents[code] && !C.centres[code]) {
      zone.innerHTML = decomposition +
        '<p class="message info">🤷 Cette adresse n\'est attribuée à aucun pays dans ma base. Essaie une autre IP !</p>';
      return;
    }

    enAttente = { ip: a.texte, code, domaine: domaine || null };
    zone.innerHTML = decomposition;
    if (C.continents[code]) {
      $('pari').hidden = false;
      $('pari').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else {
      reveler(null);
    }
  }

  function hebergeurPartout(entier) {
    return HEBERGEURS_PARTOUT.find((h) => h.plages.some((plage) => {
      const [base, bits] = plage.split('/');
      const taille = 2 ** (32 - Number(bits));
      const debut = analyserIP(base).entier;
      return entier >= debut && entier < debut + taille;
    }));
  }

  function texteSavaisTu(code, distance, domaine, ip) {
    const hebergeur = hebergeurPartout(analyserIP(ip).entier);
    if (hebergeur) {
      return `Cette adresse appartient à <strong>${hebergeur.nom}</strong>, qui a des serveurs dans ${hebergeur.villes}. ` +
        'La même adresse IP répond depuis le serveur le plus proche de toi : le pays affiché est celui où l\'adresse a été enregistrée, pas forcément celui du serveur qui t\'a répondu !';
    }
    const extension = domaine ? domaine.split('.').pop() : '';
    if (EXTENSIONS_DETOURNEES[extension]) {
      return `L'extension <strong>.${extension}</strong> appartient à ${EXTENSIONS_DETOURNEES[extension]}`;
    }
    if (extension.length === 2 && extension !== 'uk' && extension.toUpperCase() !== code) {
      return `L'extension <strong>.${extension}</strong> est celle de ${echapper(nomPays(extension.toUpperCase()))}, mais le serveur est ailleurs : l'extension ne dit pas où se trouve le serveur !`;
    }
    if (distance < 1500) {
      return 'Les grandes entreprises copient leur site sur des serveurs partout dans le monde (un <strong>CDN</strong>) pour qu\'il s\'affiche plus vite. Tu es dirigé vers le serveur le plus proche de toi, pas vers le siège de l\'entreprise !';
    }
    return `Ta demande a parcouru environ <strong>${formaterKm(distance)}</strong> en une fraction de seconde, en grande partie dans des <strong>câbles sous-marins</strong> en fibre optique.`;
  }

  function reveler(pari) {
    if (!enAttente) return;
    const { ip, code, domaine } = enAttente;
    enAttente = null;
    $('pari').hidden = true;

    const continent = C.continents[code];
    const centre = C.centres[code];
    const distance = centre ? distanceKm(C.depart.lonLat, [centre[2], centre[3]]) : null;

    let messagePari = '';
    if (pari) {
      if (pari === continent) {
        etat.parisGagnes++;
        ajouterPoints(10, '🎯');
        messagePari = '<p class="message succes">🎯 <strong>Bien vu !</strong> Ton pari était juste : +10 points.</p>';
        if (etat.parisGagnes >= 3) reussirDefi('parieur');
      } else {
        messagePari = `<p class="message erreur">😮 Raté ! Tu avais parié sur : ${echapper(CONTINENTS[pari])}. Surprenant, non ?</p>`;
      }
    }

    const nouveauPays = !etat.tampons.includes(code);
    if (nouveauPays) {
      etat.tampons.push(code);
      ajouterPoints(5, '🛂');
    }

    let detailDistance = '';
    if (code === 'HK') detailDistance = 'Le serveur est à Hong Kong, tout près de toi !';
    else if (distance !== null) detailDistance = `À environ ${formaterKm(distance)} de Hong Kong`;

    $('resultat-ip').innerHTML =
      htmlDecomposition(analyserIP(ip).octets) +
      messagePari +
      `<div class="fiche-pays">${htmlDrapeau(code, true)}<div>
        <p>${domaine ? `Le serveur de <strong>${echapper(domaine)}</strong> (${echapper(ip)}) est en :` : `L'adresse ${echapper(ip)} est en :`}</p>
        <h3>${echapper(nomPays(code))}</h3>
        <p>${continent ? echapper(CONTINENTS[continent]) : ''}${continent && detailDistance ? ' · ' : ''}${echapper(detailDistance)}</p>
        ${nouveauPays ? '<p>🛂 Nouveau tampon dans ton passeport : +5 points</p>' : ''}
      </div></div>` +
      (distance !== null ? `<p class="savais-tu"><strong>Le savais-tu ?</strong> ${texteSavaisTu(code, distance, domaine, ip)}</p>` : '');

    afficherTrajet(code);
    colorierPaysVisites();

    etat.historique.push({ domaine, ip, code });
    if (etat.historique.length > 50) etat.historique.shift();

    if (domaine && /(^|\.)alibaba\.com$/.test(domaine)) reussirDefi('alibaba');
    if (code === 'FR') reussirDefi('france');
    if (distance !== null && distance > 10000) reussirDefi('loin');
    if (continentsVisites().size >= 3) reussirDefi('continents');

    afficherTampons(nouveauPays ? code : null);
    afficherHistorique();
    sauvegarder();
  }

  // =========================================================================
  // Branchements
  // =========================================================================

  function initialiser() {
    $('score').textContent = etat.points;
    $('date-secours').textContent = new Date(window.HORS_LIGNE.date).toLocaleDateString('fr-FR');
    $('version-base').textContent = window.IP_PAYS.source.replace('dbip-country-lite-', 'version ');

    $('suggestions').innerHTML = '<span class="explication">Essaie :</span> ' + SUGGESTIONS.map((d) =>
      `<button type="button" class="puce" data-domaine="${d}">${d}</button>`).join('');

    $('pari-choix').innerHTML = CHOIX_PARI.map((c) =>
      `<button type="button" data-continent="${c}">${CONTINENTS[c]}</button>`).join('');

    dessinerCarte();
    afficherDefis();
    afficherTampons();
    afficherHistorique();

    $('form-dns').addEventListener('submit', (e) => {
      e.preventDefault();
      chercherDomaine($('saisie-domaine').value);
    });
    $('form-ip').addEventListener('submit', (e) => {
      e.preventDefault();
      const ip = $('saisie-ip').value.trim();
      // si l'IP vient de l'étape 1, on garde le nom du site pour le carnet
      localiser(ip, ipsDuDomaine.includes(ip) ? domaineCourant : null);
    });

    document.addEventListener('click', (e) => {
      const puce = e.target.closest('[data-domaine]');
      if (puce) {
        $('saisie-domaine').value = puce.dataset.domaine;
        chercherDomaine(puce.dataset.domaine);
        return;
      }
      const boutonIP = e.target.closest('[data-ip]');
      if (boutonIP) {
        $('saisie-ip').value = boutonIP.dataset.ip;
        localiser(boutonIP.dataset.ip, domaineCourant);
        $('titre-etape2').scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      const choix = e.target.closest('[data-continent]');
      if (choix) reveler(choix.dataset.continent);
    });

    // le score reste visible en haut à droite quand l'en-tête disparaît
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(([entree]) => {
        $('boite-score').classList.toggle('flottant', !entree.isIntersecting);
      }).observe(document.querySelector('.entete'));
    }
    $('pari-passer').addEventListener('click', () => reveler(null));

    $('recommencer').addEventListener('click', () => {
      if (!confirm('Effacer tout ton carnet (points, tampons, défis) ?')) return;
      etat = etatVide();
      sauvegarder();
      scoreAffiche = 0;
      $('score').textContent = 0;
      afficherDefis();
      afficherTampons();
      afficherHistorique();
      colorierPaysVisites();
      $('calque-trajet').innerHTML = '';
      document.querySelectorAll('#carte .pays.vise').forEach((p) => p.classList.remove('vise'));
    });
  }

  initialiser();
})();
