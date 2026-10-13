// Résout à l'avance une liste de sites connus, pour le mode secours du site
// (quand le réseau de l'école bloque les annuaires DNS en ligne).
//
//   node resoudre-domaines.js
//
// Produit ../docs/data/hors-ligne.js. Modifier la liste DOMAINES puis relancer.

const fs = require('fs');
const path = require('path');

const DOMAINES = [
  // demandés dans l'activité
  'alibaba.com',
  // réseaux sociaux, jeux, vidéo
  'tiktok.com', 'instagram.com', 'snapchat.com', 'youtube.com', 'netflix.com', 'twitch.tv',
  'discord.com', 'roblox.com', 'minecraft.net', 'fortnite.com', 'spotify.com', 'whatsapp.com',
  // moteurs, IA, services
  'google.com', 'wikipedia.org', 'chatgpt.com', 'mistral.ai', 'apple.com', 'microsoft.com',
  'amazon.com', 'samsung.com',
  // France
  'education.gouv.fr', 'pix.fr', 'lemonde.fr', 'leboncoin.fr', 'sncf-connect.com', 'laposte.fr',
  'index-education.com', 'francetvinfo.fr', 'meteofrance.com',
  // Asie
  'www.gov.hk', 'www.hko.gov.hk', 'baidu.com', 'qq.com', 'taobao.com', 'naver.com', 'yahoo.co.jp',
  'rakuten.co.jp', 'shopee.sg',
  // reste du monde
  'bbc.co.uk', 'yandex.ru', 'mercadolibre.com.ar', 'globo.com', 'abc.net.au', 'nzherald.co.nz',
  'cbc.ca', 'jumia.com.ng', 'aljazeera.com',
];

async function resoudre(domaine) {
  const url = 'https://dns.google/resolve?type=A&name=' + encodeURIComponent(domaine);
  const reponse = await fetch(url);
  const json = await reponse.json();
  const reponses = json.Answer || [];
  return {
    alias: reponses.filter((r) => r.type === 5).map((r) => r.data.replace(/\.$/, '')),
    ips: reponses.filter((r) => r.type === 1).map((r) => r.data),
  };
}

(async () => {
  const resultats = {};
  for (const domaine of DOMAINES) {
    try {
      const r = await resoudre(domaine);
      if (r.ips.length === 0) throw new Error('aucune IPv4');
      resultats[domaine] = r;
      console.log(domaine.padEnd(24), r.ips.join(' '));
    } catch (e) {
      console.warn('ÉCHEC', domaine, e.message);
    }
  }
  const date = new Date().toISOString().slice(0, 10);
  const contenu =
    '// Généré par outils/resoudre-domaines.js — ne pas modifier à la main.\n' +
    'window.HORS_LIGNE = ' + JSON.stringify({ date, domaines: resultats }, null, 1) + ';\n';
  fs.writeFileSync(path.join(__dirname, '..', 'docs', 'data', 'hors-ligne.js'), contenu);
  console.log(`hors-ligne.js : ${Object.keys(resultats).length} domaines (${date})`);
})();
