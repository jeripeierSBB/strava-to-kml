# strava-to-kml

This tool extracts your Strava archive and generates a KML file with all your activities, grouped by activity type and color-coded.
Supported activity file formats: **GPX**, **TCX** (`.gz` compressed supported), **FIT**.

## Usage

### Option A – Strava download link (URL)

Pass the download link from the Strava export e-mail directly – the script will download the archive automatically:

```sh
npm install
node ./strava-to-kml.ts "https://..."
```

> Make sure to wrap the URL in quotes so the shell doesn't interpret special characters.

### Option B – Local archive file

1. **Download your Strava archive**
   - Go to [Strava Settings > Account > Download your Account](https://www.strava.com/account)
   - Request your archive and download the ZIP file
   - Place the ZIP file (e.g. `strava-archive.zip`) in the project root

2. **Run the script**

   ```sh
   npm install
   node ./strava-to-kml.ts <your-archive.zip>
   ```

## Result

- The file `activities.kml` will be generated in the project root.
- Open it in **Google Earth** or any other KML viewer.

---

> **Note:** The script automatically extracts, processes, and cleans up all temporary files. Only the final `activities.kml` will remain.
