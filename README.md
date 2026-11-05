# Allenamento

Web app (PWA) personale per registrare gli allenamenti: schede, serie, pesi, recupero, passi, acqua, peso e integratori.

- Sito statico: nessun server, nessuna build. Serve solo HTTPS.
- I dati restano **sul dispositivo** (localStorage); non vengono inviati da nessuna parte.
- Backup ed esportazione: scheda **Altro** → *Esporta backup*.

## Pubblicazione con GitHub Pages
1. Repository → **Settings → Pages**.
2. *Build and deployment* → Source: **Deploy from a branch**, branch `main`, cartella `/ (root)`.
3. L'indirizzo sarà `https://<utente>.github.io/<nome-repository>/`.

## Installazione su iPhone
Apri l'indirizzo in **Safari** → Condividi → **Aggiungi a schermata Home**.

## Aggiornamenti
Dopo ogni modifica ai file dell'app aumenta il numero di versione in `service-worker.js` (`CACHE`, `?v=`) e in `index.html` (`?v=`), così l'iPhone scarica i file nuovi.
