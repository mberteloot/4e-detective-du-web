// Construit les fichiers de données du site (à relancer 1 à 2 fois par an).
//
//   node construire-donnees.js <chemin vers dbip-country-lite-AAAA-MM.csv.gz>
//
// Produit dans ../docs/data/ :
//   ip-pays.js  : plages IPv4 → code pays (base DB-IP Lite, CC BY 4.0), encodées en base64
//   carte.js    : carte du monde en SVG précalculé (Natural Earth via world-atlas) + infos pays
//
// Les fichiers sont des .js (et non des .json) pour que le site marche aussi
// en ouvrant index.html directement depuis le disque (file://), sans serveur.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const d3 = require('d3-geo');
const topojson = require('topojson-client');
const isoPays = require('i18n-iso-countries');
const { countries: infosPays } = require('countries-list');

const DOSSIER_DATA = path.join(__dirname, '..', 'docs', 'data');

// ---------------------------------------------------------------------------
// 1. Base IP → pays
// ---------------------------------------------------------------------------

function ipVersEntier(ip) {
  const p = ip.split('.').map(Number);
  return ((p[0] * 256 + p[1]) * 256 + p[2]) * 256 + p[3];
}

function construireIpPays(cheminCsvGz) {
  const lignes = zlib.gunzipSync(fs.readFileSync(cheminCsvGz)).toString('utf8').split(/\r?\n/);
  const plages = []; // [debut, codePays], fusionnées si le pays se répète
  let finPrecedente = -1;

  for (const ligne of lignes) {
    if (!ligne || ligne.includes(':')) continue; // on ignore les IPv6
    const [debutTxt, finTxt, code] = ligne.split(',');
    const debut = ipVersEntier(debutTxt);
    const fin = ipVersEntier(finTxt);
    if (debut !== finPrecedente + 1) {
      // trou dans la base : on le marque comme inconnu
      plages.push([finPrecedente + 1, 'ZZ']);
    }
    if (plages.length === 0 || plages[plages.length - 1][1] !== code) {
      plages.push([debut, code]);
    }
    finPrecedente = fin;
  }

  const codes = [...new Set(plages.map((p) => p[1]))].sort();
  if (codes.length > 255) throw new Error('Trop de codes pays pour un octet');
  const indexCode = new Map(codes.map((c, i) => [c, i]));

  // Encodage : pour chaque plage, écart avec le début précédent (varint) puis 1 octet pays.
  const octets = [];
  let debutPrecedent = 0;
  for (const [debut, code] of plages) {
    let ecart = debut - debutPrecedent;
    debutPrecedent = debut;
    while (ecart >= 128) {
      octets.push((ecart % 128) | 128);
      ecart = Math.floor(ecart / 128);
    }
    octets.push(ecart);
    octets.push(indexCode.get(code));
  }

  const nomSource = path.basename(cheminCsvGz).replace('.csv.gz', '');
  const contenu =
    '// Généré par outils/construire-donnees.js — ne pas modifier à la main.\n' +
    '// Source : ' + nomSource + ' — IP Geolocation by DB-IP (https://db-ip.com), licence CC BY 4.0.\n' +
    'window.IP_PAYS = ' + JSON.stringify({
      source: nomSource,
      nombre: plages.length,
      codes: codes.join(''),
      donnees: Buffer.from(octets).toString('base64'),
    }) + ';\n';
  fs.writeFileSync(path.join(DOSSIER_DATA, 'ip-pays.js'), contenu);
  console.log(`ip-pays.js : ${plages.length} plages, ${codes.length} codes, ${(contenu.length / 1024).toFixed(0)} Ko`);
}

// ---------------------------------------------------------------------------
// 2. Carte du monde
// ---------------------------------------------------------------------------

const LARGEUR = 1000;
const HAUTEUR = 520;
const POINT_DEPART = { code: 'HK', nom: 'Hong Kong', lonLat: [114.17, 22.32] };

function arrondirChemin(d) {
  return d.replace(/-?\d+\.\d+/g, (n) => String(Math.round(Number(n) * 10) / 10));
}

function codeDepuisNumerique(id) {
  if (!id) return null;
  return isoPays.numericToAlpha2(String(id).padStart(3, '0')) || null;
}

function construireCarte() {
  const monde110 = require('world-atlas/countries-110m.json');
  const monde50 = require('world-atlas/countries-50m.json');
  const pays110 = topojson.feature(monde110, monde110.objects.countries).features;
  const pays50 = topojson.feature(monde50, monde50.objects.countries).features;

  // carte centrée sur le Pacifique (150° E) : vue « depuis Hong Kong »,
  // l'arc vers l'Amérique traverse le Pacifique comme les vrais câbles
  const projection = d3.geoNaturalEarth1()
    .rotate([-150, 0])
    .fitExtent([[5, 5], [LARGEUR - 5, HAUTEUR - 5]], { type: 'Sphere' });
  const chemin = d3.geoPath(projection);
  const arrondi = (v) => Math.round(v * 10) / 10;
  const point = (lonLat) => projection(lonLat).map(arrondi);
  const centre = (lonLat) => [...point(lonLat), ...lonLat.map(arrondi)];

  const formes = {};   // code → chemin SVG (carte 110m, légère)
  const centres = {};  // code → [x, y, longitude, latitude] (carte 50m, avec les petits pays)
  const sansCode = []; // territoires sans code ISO (Kosovo, Chypre du Nord…) : dessinés en gris

  for (const f of pays110) {
    const code = codeDepuisNumerique(f.id);
    const d = arrondirChemin(chemin(f));
    if (code) formes[code] = d; else sansCode.push(d);
  }
  for (const f of pays50) {
    const code = codeDepuisNumerique(f.id);
    if (!code) continue;
    // centre de la plus grande partie du pays (évite les centres « dans l'océan »)
    let geo = f;
    if (f.geometry.type === 'MultiPolygon') {
      const parties = f.geometry.coordinates.map((c) => ({ type: 'Polygon', coordinates: c }));
      geo = parties.reduce((a, b) => (d3.geoArea(a) >= d3.geoArea(b) ? a : b));
    }
    centres[code] = centre(d3.geoCentroid(geo));
  }
  // France : centre de la métropole (la géométrie inclut la Guyane)
  centres.FR = centre([2.5, 46.5]);

  const continents = {};
  for (const [code, infos] of Object.entries(infosPays)) continents[code] = infos.continent;

  const contenu =
    '// Généré par outils/construire-donnees.js — ne pas modifier à la main.\n' +
    '// Fond de carte : Natural Earth (domaine public) via world-atlas.\n' +
    'window.CARTE = ' + JSON.stringify({
      largeur: LARGEUR,
      hauteur: HAUTEUR,
      contour: arrondirChemin(chemin({ type: 'Sphere' })),
      depart: { code: POINT_DEPART.code, nom: POINT_DEPART.nom, xy: point(POINT_DEPART.lonLat), lonLat: POINT_DEPART.lonLat },
      formes,
      sansCode,
      centres,
      continents,
    }) + ';\n';
  fs.writeFileSync(path.join(DOSSIER_DATA, 'carte.js'), contenu);
  console.log(`carte.js : ${Object.keys(formes).length} formes, ${Object.keys(centres).length} centres, ${(contenu.length / 1024).toFixed(0)} Ko`);
}

// ---------------------------------------------------------------------------

const cheminCsv = process.argv[2];
if (!cheminCsv) {
  console.error('Usage : node construire-donnees.js <dbip-country-lite-AAAA-MM.csv.gz>');
  process.exit(1);
}
fs.mkdirSync(DOSSIER_DATA, { recursive: true });
construireIpPays(cheminCsv);
construireCarte();
