/**
 * SAMO Passport — Drive upload web app (Google Apps Script)
 *
 * Lets the admin terminal upload badge / certificate images straight to the SAMO
 * Google Drive (uses its 2TB, because this script runs AS the SAMO account), and
 * delete them again when an activity is removed.
 *
 * ── One-time setup ───────────────────────────────────────────────────────────
 * 1. https://script.google.com (as the SAMO account) → New project → paste this.
 * 2. Set FOLDER_ID to the parent Drive folder (open it in Drive; the ID is the
 *    last URL segment). Empty = My Drive root.
 * 3. Deploy → New deployment → "Web app": Execute as = Me, Who has access = Anyone.
 *    Copy the /exec URL.
 * 4. Put it in env as VITE_GAS_UPLOAD_URL (.env + Cloudflare) and rebuild.
 *
 * Re-deploying after edits: Deploy → Manage deployments → ✏️ → Version = New version.
 *
 * Files are organised into per-type subfolders ("badges", "certificates") and
 * named sequentially within each folder: 0001.png, 0002.png, …
 *
 * Request body (JSON, sent as text/plain):
 *   upload: { filename, mimeType, folder, data(base64) }
 *   delete: { action: "delete", fileId }
 */

var FOLDER_ID = ''; // e.g. '1AbCdEfGh...'; empty = My Drive root

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);

    if (body.action === 'delete') {
      return handleDelete_(body.fileId);
    }
    return handleUpload_(body);
  } catch (err) {
    return json_({ error: String(err) });
  }
}

function handleUpload_(body) {
  var bytes = Utilities.base64Decode(body.data);
  var blob = Utilities.newBlob(bytes, body.mimeType || 'application/octet-stream', 'tmp');

  var parent = FOLDER_ID ? DriveApp.getFolderById(FOLDER_ID) : DriveApp.getRootFolder();
  if (body.folder) {
    var it = parent.getFoldersByName(body.folder);
    parent = it.hasNext() ? it.next() : parent.createFolder(body.folder);
  }

  // Sequential, zero-padded name within this folder: 0001, 0002, …
  var count = 0;
  var files = parent.getFiles();
  while (files.hasNext()) { files.next(); count++; }
  var ext = String(body.filename || '').split('.').pop().toLowerCase();
  var hasExt = ext && ext.length <= 5 && ext !== body.filename;
  var name = ('0000' + (count + 1)).slice(-4) + (hasExt ? '.' + ext : '');

  var file = parent.createFile(blob.setName(name));
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  return json_({ url: 'https://drive.google.com/file/d/' + file.getId() + '/view', name: name });
}

function handleDelete_(fileId) {
  if (!fileId) return json_({ error: 'no fileId' });
  try {
    DriveApp.getFileById(fileId).setTrashed(true);
    return json_({ ok: true });
  } catch (err) {
    // File may be external / already gone — not fatal.
    return json_({ ok: false, error: String(err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
