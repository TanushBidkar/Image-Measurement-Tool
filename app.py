# --- Main Imports ---
from flask import Flask, request, jsonify, render_template, send_from_directory
import cv2
import os
import math
from werkzeug.utils import secure_filename

# --- NEW: Import PyMuPDF (fitz) instead of pdf2image ---
# This version does NOT require Poppler.
# Ensure you have installed it: pip install PyMuPDF
import fitz

app = Flask(__name__)
app.config['UPLOAD_FOLDER'] = 'uploads'
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024  # 50MB max file size

# Create upload directory if it doesn't exist
if not os.path.exists(app.config['UPLOAD_FOLDER']):
    os.makedirs(app.config['UPLOAD_FOLDER'])

class ImageMeasurer:
    def __init__(self):
        self.pixels_per_unit = 1.0
        self.reference_length = 1.0
        
    def set_calibration(self, pixel_distance, real_distance):
        if pixel_distance > 0:
            self.pixels_per_unit = pixel_distance / real_distance
    
    def pixel_to_feet(self, pixel_distance):
        if self.pixels_per_unit > 0:
            return pixel_distance / self.pixels_per_unit
        return 0
    
    def calculate_distance(self, pt1, pt2):
        return math.sqrt((pt1[0] - pt2[0])**2 + (pt1[1] - pt2[1])**2)

# Global measurer instance
measurer = ImageMeasurer()

# --- REVISED: PDF Conversion using PyMuPDF ---
def convert_pdf_to_image(pdf_path, output_folder):
    """Converts the first page of a PDF to a PNG image using PyMuPDF."""
    try:
        # Open the PDF file
        doc = fitz.open(pdf_path)
        
        # Get the first page (page index 0)
        page = doc.load_page(0)
        
        # Render the page to an image (pixmap) with a good resolution
        pix = page.get_pixmap(dpi=200)
        
        # Define the output image path
        base_filename = os.path.splitext(os.path.basename(pdf_path))[0]
        image_filename = f"{base_filename}.png"
        image_path = os.path.join(output_folder, image_filename)
        
        # Save the image and close the document
        pix.save(image_path)
        doc.close()
        
        # Return the new filename and its full path
        return image_filename, image_path
        
    except Exception as e:
        print(f"PDF conversion error with PyMuPDF: {e}")
        return None, None

# --- Flask Routes ---

@app.route('/')
def index():
    # Assumes you have an 'index.html' in a 'templates' folder
    return render_template('index.html')

@app.route('/upload', methods=['POST'])
def upload_file():
    try:
        if 'file' not in request.files:
            return jsonify({'error': 'No file uploaded'}), 400
        
        file = request.files['file']
        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400
        
        if file:
            filename = secure_filename(file.filename)
            filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
            file.save(filepath)
            
            # Handle PDF file uploads using the new function
            if filename.lower().endswith('.pdf'):
                image_filename, image_filepath = convert_pdf_to_image(filepath, app.config['UPLOAD_FOLDER'])
                
                if image_filename and image_filepath:
                    # Update filename and filepath to point to the converted image
                    filename = image_filename
                    filepath = image_filepath
                else:
                    # If conversion fails, return a generic error
                    return jsonify({'error': 'Failed to convert the provided PDF file.'}), 500
            
            # Process the image (original or converted) and get its dimensions
            img = cv2.imread(filepath)
            if img is not None:
                height, width = img.shape[:2]
                return jsonify({
                    'success': True,
                    'filename': filename,
                    'width': width,
                    'height': height
                })
            else:
                return jsonify({'error': 'Invalid or unsupported image file'}), 400
            
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/calibrate', methods=['POST'])
def calibrate():
    try:
        data = request.json
        pixel_distance = float(data.get('pixel_distance', 0))
        real_distance = float(data.get('real_distance', 1))
        
        measurer.set_calibration(pixel_distance, real_distance)
        
        return jsonify({
            'success': True,
            'pixels_per_unit': measurer.pixels_per_unit
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/measure', methods=['POST'])
def measure():
    try:
        data = request.json
        x1, y1 = data.get('x1', 0), data.get('y1', 0)
        x2, y2 = data.get('x2', 0), data.get('y2', 0)
        
        pixel_distance = measurer.calculate_distance((x1, y1), (x2, y2))
        real_distance = measurer.pixel_to_feet(pixel_distance)
        
        return jsonify({
            'pixel_distance': pixel_distance,
            'real_distance': round(real_distance, 2),
            'unit': 'feet'
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/uploads/<filename>')
def uploaded_file(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)

# --- Main entry point to run the app ---
if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)