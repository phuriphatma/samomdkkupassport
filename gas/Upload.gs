/**
 * SAMO Passport — Drive upload web app (Google Apps Script)
 *
 * Lets the admin terminal upload badge / certificate images straight to the SAMO
 * Google Drive (uses its 2TB, because this script runs AS the SAMO account).
 *
 * ── One-time setup ───────────────────────────────────────────────────────────
 * 1. Go to https://script.google.com (signed in as the SAMO account) → New project.
 * 2. Paste this file in.
 * 3. Set FOLDER_ID below to the Drive folder you want uploads to go into
 *    (open the folder in Drive; the ID is the last part of the URL). Leave as-is
 *    to use My Drive root.
 * 4. Deploy → New deployment → type "Web app":
 *      - Execute as: Me (the SAMO account)
 *      - Who has access: Anyone
 *    Copy the Web app URL (ends in /exec).
 * 5. Put that URL in your env as VITE_GAS_UPLOAD_URL (.env locally, and in the
 *    Cloudflare Pages project settings), then rebuild/redeploy the site.
 *
 * Security note: "Anyone" can POST to this endpoint. It only creates files in the
 * chosen folder and returns their link — it never reads/deletes anything. If you
 * want it locked down, add a shared-secret check on body.secret.
 */

var FOLDER_ID = ''; // e.g. '1AbCdEfGh...'; empty = My Drive root

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);

    var bytes = Utilities.base64Decode(body.data);
    var blob = Utilities.newBlob(
      bytes,
      body.mimeType || 'application/octet-stream',
      body.filename || ('upload-' + Date.now())
    );

    var parent = FOLDER_ID ? DriveApp.getFolderById(FOLDER_ID) : DriveApp.getRootFolder();

    // Optional per-type subfolder (e.g. "badges" / "certificates"), auto-created.
    if (body.folder) {
      var it = parent.getFoldersByName(body.folder);
      parent = it.hasNext() ? it.next() : parent.createFolder(body.folder);
    }

    var file = parent.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    var url = 'https://drive.google.com/file/d/' + file.getId() + '/view';
    return json_({ url: url });
  } catch (err) {
    return json_({ error: String(err) });
  }
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
