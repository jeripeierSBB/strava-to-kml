# strava-to-kml

This tool extracts your Strava archive and generates a KML file with all your activities, grouped by activity type.

## Usage

1. **Download your Strava archive**
   - Go to [Strava Settings > Download or Delete Your Account](https://www.strava.com/settings/data_export)
   - Request your archive and download the `strava-archiv.zip` file
   - Place `strava-archiv.zip` in the root of this project directory

2. **Run the script**
   - Make sure you have Node.js (v24+) and all dependencies installed (`npm install`)
   - Run the following command:

     ```sh
     node ./strava-to-kml.ts
     ```

3. **Result**
   - The file `activities.kml` will be generated in the project root
   - You can open this file in Google Earth or any KML viewer

---

> **Note:** This script will automatically extract, process, and clean up all temporary files. Only the final `activities.kml` will remain.
