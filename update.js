import axios from "axios";

async function checkUpdate(url) {
  try {
    const response = await axios.head(url);
    const lastModified = response.headers["last-modified"];
    console.log("Last Modified:", lastModified);
    return new Date(lastModified);
  } catch (err) {
    console.error("Error:", err.message);
  }
}

(async () => {
  const url = "https://epgshare01.online/epgshare01/epg_ripper_US1.xml.gz";
  const lastModified = await checkUpdate(url);
})();
