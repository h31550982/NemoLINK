# Palautuspiste: asetussivun hover-korjaus ja Blue/100

Nimi: `settings-hover-fixed-blue100-2026-11-07_200802`
Luotu: 7.11.2026 klo 20.08 (Europe/Helsinki).
Alkuperäinen projekti: `/Users/sofiamesterton/Downloads/nemolink`.

Tässä versiossa asetussivun tausta on Blue/100 (`#FFFFFF`). Taulukoiden hover-väri piirretään solun taustaksi ja tekstin peittänyt pseudo-elementti poistetaan hoverissa. Korjaus on tiedostossa `project/app/src/pages/AdminPage.vue`.

## Sisältö

- `project/`: projektin lähdekoodi, paikalliset asetukset, pakettien lock-tiedostot, Docker-asetukset, migraatiot, vendor-aineisto sekä projektin ohjeet ja skillit.
- `claude-project-memory/`: projektin 27 Claude-muistitiedostoa.
- `database.dump`: paikallisen PostgreSQL-tietokannan yhtenäinen tilannekuva custom-muodossa.
- `source-manifest.json`, `SHA256SUMS` ja `snapshot.json`: tarkistussummat ja kopion tiedot.

Uudelleen luotavat `node_modules`, `dist` ja `.quasar`, välimuistilokit sekä aikaisemmat varmuuskopiot on jätetty pois. Tarvittavat riippuvuudet asennetaan tarvittaessa lock-tiedostoista komennolla `npm ci`.

## Palauttaminen

Voit pyytää: **"Palauta varmuuskopio settings-hover-fixed-blue100-2026-11-07_200802."**

1. Ota ennen palautusta uusi kopio senhetkisestä tilanteesta.
2. Käyttöliittymän palautuksessa korvaa projektin `app/` tämän kopion `project/app/`-hakemistolla. Koko projektin lähdekoodia palautettaessa käytä koko `project/`-sisältöä. Säilytä nykyinen `backups/`-hakemisto.
3. Käyttöliittymän palautuksen jälkeen suorita projektin juuressa `docker compose up -d --build --no-deps nemolink-app` ja päivitä selain komennolla Cmd+Shift+R. Jos palvelimen lähdekoodikin palautetaan, rakenna myös palautetut palvelinkontit uudelleen.
4. `database.dump` mahdollistaa myös tietojen palauttamisen tähän hetkeen. Pelkkää ulkoasuversiota palautettaessa tietokantaa ei tarvitse palauttaa. Tietokantapalautusta varten pysäytä tietokantaan kirjoittavat palvelut ja käytä PostgreSQL 18:n `pg_restore`-työkalua; tietokannan nykyinen tilanne varmuuskopioidaan ensin.
5. Claude-muistin palautuslähde on `claude-project-memory/`; alkuperäinen hakemisto on `/Users/sofiamesterton/.claude/projects/-Users-sofiamesterton-Downloads-nemolink/memory/`.

## Tarkistus

Kaikki 616 kopioitua lähde- ja muistitiedostoa tarkistettiin SHA-256-summilla alkuperäisiä vasten. Tietokanta-arkisto luettiin kokonaan onnistuneesti komennolla `pg_restore --file=/dev/null`.

Voit tarkistaa varmuuskopion eheyden tässä kansiossa:

```sh
shasum -a 256 -c SHA256SUMS
```
