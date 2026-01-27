from flask import Flask, request, jsonify
from flask_cors import CORS
import fitz  # PDF
import docx
from PIL import Image
import pytesseract
import io
import os

# 🔽 ADD THIS (Windows fix)
pytesseract.pytesseract.tesseract_cmd = r"C:\Program Files\Tesseract-OCR\tesseract.exe"

app = Flask(__name__)
CORS(app)

app = Flask(__name__)
CORS(app)

@app.route("/extract-text", methods=["POST"])
def extract_text():
    file = request.files["file"]
    filename = file.filename.lower()
    text = ""

    if filename.endswith(".pdf"):
        doc = fitz.open(stream=file.read(), filetype="pdf")
        for page in doc:
            text += page.get_text()

    elif filename.endswith(".docx"):
        document = docx.Document(file)
        for para in document.paragraphs:
            text += para.text + "\n"

    elif filename.endswith((".png", ".jpg", ".jpeg")):
        image = Image.open(io.BytesIO(file.read()))
        image = image.convert("L")  # grayscale improves OCR
        text = pytesseract.image_to_string(image)

    else:
        return jsonify({"error": "Unsupported file type"}), 400

    return jsonify({"text": text.strip()})

if __name__ == "__main__":
    app.run(debug=True)
