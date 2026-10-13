# 🕵️ Détective du Web (technologie 4e)

**En ligne : https://mberteloot.github.io/4e-detective-du-web/**

Petit site pour des élèves de 4e (activité « Mes données sur le web ») : on tape un **nom de domaine**,
on obtient ses **adresses IP** (DNS), puis le **pays** du serveur, affiché sur une carte du monde centrée
sur Hong Kong. Pari sur le continent, points (score flottant animé), défis, passeport à tampons et tableau
« Mes découvertes » pour remplir la fiche.

Exemples vérifiés (base 2026-10) : alibaba.com → États-Unis ; pix.fr → États-Unis (CDN Imperva), laposte.fr → France.

## Pourquoi c'est fiable en classe

| Fonction | Comment | Si ça bloque |
|---|---|---|
| Nom → IP | Annuaires DNS-over-HTTPS : Google, puis Cloudflare (4 s max chacun) | **Mode secours** : 48 sites connus résolus à l'avance (`docs/data/hors-ligne.js`) |
| IP → pays | Base **DB-IP Lite** embarquée dans le site | Rien ne peut bloquer : aucune requête réseau, aucun quota |
| Carte | SVG précalculé (Natural Earth) | Aucune bibliothèque, aucune requête |

Aucune donnée élève n'est collectée. Le carnet (points, tampons) reste dans le navigateur (`localStorage`).
Le site marche aussi en ouvrant `docs/index.html` directement depuis le disque.

Les adresses Cloudflare/Fastly (anycast) sont signalées à l'élève : le pays de la base n'est que le pays
d'enregistrement (ex. discord.com « au Canada »).

## Publication

GitHub Pages, branche `main`, dossier `/docs` : chaque `git push` met le site à jour en 1 à 2 minutes.

## Mise à jour des données (1 à 2 fois par an)

```
cd outils
npm install
# télécharger https://download.db-ip.com/free/dbip-country-lite-AAAA-MM.csv.gz (mois en cours)
node construire-donnees.js chemin/vers/dbip-country-lite-AAAA-MM.csv.gz
node resoudre-domaines.js          # rafraîchit la liste de secours
node tester.js chemin/vers/dbip-country-lite-AAAA-MM.csv.gz
```

Pour ajouter un site à la liste de secours : l'ajouter dans `DOMAINES` (`outils/resoudre-domaines.js`)
puis relancer `node resoudre-domaines.js`. Le fichier `.csv.gz` n'est pas versionné.

## Structure

```
docs/                    ← le site publié (HTML + CSS + JS, aucune bibliothèque, aucun module)
  data/ip-pays.js        ← plages IPv4 → pays (généré, ne pas éditer)
  data/carte.js          ← carte du monde SVG + continents (généré)
  data/hors-ligne.js     ← liste de secours DNS (généré)
outils/                  ← scripts Node (construction des données, tests jsdom)
```

## Crédits

- IP Geolocation by [DB-IP](https://db-ip.com) — licence CC BY 4.0
- Fond de carte : [Natural Earth](https://www.naturalearthdata.com) (domaine public), via `world-atlas`
- Annuaires : Google Public DNS, Cloudflare DNS
