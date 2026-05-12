// Set your deployed Apps Script Web App URL here
const APPS_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbyO3-OUjkk4ni2OhCUByqSJWaSkRX59a852eMTNmeHL_F9VLsahhVqLSewC1W5nvyVl/exec";

let cropper;
let originalInputId = null;
let originalUrlBoxId = null;

export function setupCropper() {
  const modal = document.getElementById("cropper-modal");
  const imgEL = document.getElementById("cropper-image");
  const confirmBtn = document.getElementById("btn-crop-confirm");

  function handleFileSelect(inputId, urlBoxId) {
    const input = document.getElementById(inputId);
    input.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;

      originalInputId = inputId;
      originalUrlBoxId = urlBoxId;

      const reader = new FileReader();
      reader.onload = (event) => {
        imgEL.src = event.target.result;
        modal.style.display = "flex";

        if (cropper) cropper.destroy();
        cropper = new Cropper(imgEL, {
          aspectRatio: 1, // Square for badges
          viewMode: 1,
        });
      };
      reader.readAsDataURL(file);
      // Reset input
      input.value = "";
    });
  }

  // Setup listeners for both Create & Edit forms
  handleFileSelect("act-file-upload", "act-badge-url");
  handleFileSelect("edit-file-upload", "edit-badge-url");

  confirmBtn.onclick = async () => {
    if (!cropper) return;

    // 1. Get raw base64 data to upload
    const canvas = cropper.getCroppedCanvas({ width: 400, height: 400 });
    const base64Image = canvas.toDataURL("image/png");

    // Fill the URL box temporarily with a "Uploading..." message
    const urlBox = document.getElementById(originalUrlBoxId);
    urlBox.value = "Uploading to Drive...";
    modal.style.display = "none";

    try {
      if (APPS_SCRIPT_URL === "YOUR_APPS_SCRIPT_WEB_APP_URL") {
        alert(
          "You must put your Google Apps Script URL in js/cropper-setup.js first! Using raw Base64 data as fallback (Warning: Very large!).",
        );
        urlBox.value = base64Image;
        return;
      }

      // Convert to clean base64 string without data header
      const base64Data = base64Image.replace(/^data:image\/\w+;base64,/, "");

      // 2. Upload to Apps Script Web App
      const res = await fetch(APPS_SCRIPT_URL, {
        method: "POST",
        body: JSON.stringify({
          name: "badge_" + Date.now() + ".png",
          base64: base64Data,
        }),
        headers: {
          "Content-Type": "text/plain", // Avoids CORS pre-flight
        },
      });

      const data = await res.json();
      if (data.success) {
        urlBox.value = data.url;
      } else {
        throw new Error(data.error || "Unknown Apps Script upload error.");
      }
    } catch (err) {
      console.error(err);
      alert("Error uploading image: " + err.message);
      urlBox.value = "";
    }
  };
}
