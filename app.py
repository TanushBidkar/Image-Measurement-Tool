# --- Main Imports ---
from flask import Flask, request, jsonify, render_template, send_from_directory
import cv2
import os
import math
from werkzeug.utils import secure_filename
import numpy as np
from collections import defaultdict

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

@app.route('/detect-legends', methods=['POST'])
def detect_legends():
    try:
        data = request.json
        filename = data.get('filename')
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        
        img = cv2.imread(filepath)
        if img is None:
            return jsonify({'error': 'Could not read image file'}), 400
            
        hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        
        # Enhanced color ranges with more patterns
        color_ranges = {
            'red': ([0, 100, 100], [10, 255, 255]),
            'red2': ([170, 100, 100], [180, 255, 255]),  # Second red range
            'green': ([35, 50, 50], [85, 255, 255]),
            'blue': ([95, 50, 50], [135, 255, 255]),
            'orange': ([8, 100, 100], [25, 255, 255]),
            'pink': ([145, 50, 50], [175, 255, 255]),
            'cyan': ([80, 50, 50], [100, 255, 255]),
            'yellow': ([20, 100, 100], [35, 255, 255]),
            'purple': ([125, 50, 50], [145, 255, 255])
        }
        
        detected_legends = []
        legend_id = 0
        
        for color_name, (lower, upper) in color_ranges.items():
            lower = np.array(lower)
            upper = np.array(upper)
            
            # Create mask
            mask = cv2.inRange(hsv, lower, upper)
            
            # Morphological operations to clean up
            kernel = np.ones((3,3), np.uint8)
            mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
            mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
            
            # Find contours
            contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            
            for contour in contours:
                area = cv2.contourArea(contour)
                if area > 50:  # Lower threshold to detect more
                    x, y, w, h = cv2.boundingRect(contour)
                    
                    # Skip very small or very large regions
                    if w < 10 or h < 10 or w > img.shape[1]*0.8 or h > img.shape[0]*0.8:
                        continue
                    
                    # Get extreme points
                    leftmost = tuple(contour[contour[:,:,0].argmin()][0])
                    rightmost = tuple(contour[contour[:,:,0].argmax()][0])
                    topmost = tuple(contour[contour[:,:,1].argmin()][0])
                    bottommost = tuple(contour[contour[:,:,1].argmax()][0])
                    
                    # Calculate dimensions
                    width_pixels = rightmost[0] - leftmost[0]
                    height_pixels = bottommost[1] - topmost[1]
                    
                    # Extract small preview of the legend
                    legend_preview = img[y:y+h, x:x+w]
                    preview_filename = f"legend_preview_{legend_id}.png"
                    preview_path = os.path.join(app.config['UPLOAD_FOLDER'], preview_filename)
                    cv2.imwrite(preview_path, legend_preview)
                    
                    # Determine pattern type
                    pattern_type = detect_pattern_type(legend_preview)
                    
                    detected_legends.append({
                        'id': legend_id,
                        'color': color_name.replace('2', ''),  # Remove '2' from red2
                        'pattern': pattern_type,
                        'preview_image': preview_filename,
                        'bounds': {
                            'x': int(x),
                            'y': int(y),
                            'width': int(w),
                            'height': int(h)
                        },
                        'points': {
                            'left': [int(leftmost[0]), int(leftmost[1])],
                            'right': [int(rightmost[0]), int(rightmost[1])],
                            'top': [int(topmost[0]), int(topmost[1])],
                            'bottom': [int(bottommost[0]), int(bottommost[1])]
                        },
                        'dimensions': {
                            'width': int(width_pixels),
                            'height': int(height_pixels)
                        }
                    })
                    
                    legend_id += 1
        
        return jsonify({
            'success': True,
            'legends': detected_legends,
            'total_count': len(detected_legends)
        })
        
    except Exception as e:
        print(f"Error in detect_legends: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500
def detect_pattern_type(img):
    """Improved pattern detection with better diagonal hatching recognition"""
    if img.size == 0 or img.shape[0] < 10 or img.shape[1] < 10:
        return 'solid'
    
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if len(img.shape) == 3 else img
    
    # Calculate variance
    variance = np.var(gray)
    
    # Detect edges more aggressively for hatching
    edges = cv2.Canny(gray, 20, 80)
    edge_density = np.sum(edges > 0) / edges.size
    
    # Detect lines with HoughLinesP - more sensitive settings
    lines = cv2.HoughLinesP(edges, 1, np.pi/180, threshold=10, minLineLength=8, maxLineGap=3)
    
    diagonal_count = 0
    horizontal_count = 0
    vertical_count = 0
    
    if lines is not None and len(lines) > 2:  # Need at least 3 lines for hatching
        for line in lines:
            x1, y1, x2, y2 = line[0]
            
            # Calculate angle
            dx = x2 - x1
            dy = y2 - y1
            
            if dx == 0:
                angle = 90
            else:
                angle = abs(np.arctan2(dy, dx) * 180 / np.pi)
            
            # Classify line direction with more tolerance
            if 30 < angle < 60 or 120 < angle < 150:  # Diagonal (±45°)
                diagonal_count += 1
            elif angle < 20 or angle > 160:  # Horizontal
                horizontal_count += 1
            elif 70 < angle < 110:  # Vertical
                vertical_count += 1
        
        print(f"Pattern Analysis - Lines: {len(lines)}, Diagonal: {diagonal_count}, H: {horizontal_count}, V: {vertical_count}, Edge density: {edge_density:.3f}")
        
        # Classification based on line counts
        if diagonal_count >= 3:  # At least 3 diagonal lines = hatched
            return 'hatched'
        elif horizontal_count >= 3 or vertical_count >= 3:
            return 'striped'
    
    # ... inside detect_pattern_type ...
    # Fallback to variance and edge density
    if variance > 200 and edge_density > 0.05:
        return 'hatched'
    elif variance < 100:
        return 'solid'
    elif edge_density > 0.15:
        return 'dotted'
    else:
        return 'patterned'

# --- FIX: Move this function to the far left (Global Scope) ---
def get_adaptive_mask(full_img_hsv, sample_region_hsv):
    """
    Creates a mask based on the min/max HSV values of the clicked region
    plus a tolerance, rather than using hardcoded color ranges.
    """
    # 1. Calculate the range of colors existing inside the clicked area
    h_min = np.min(sample_region_hsv[:,:,0])
    s_min = np.min(sample_region_hsv[:,:,1])
    v_min = np.min(sample_region_hsv[:,:,2])
    
    h_max = np.max(sample_region_hsv[:,:,0])
    s_max = np.max(sample_region_hsv[:,:,1])
    v_max = np.max(sample_region_hsv[:,:,2])
    
    # 2. Add Tolerance (Relax the boundaries)
    tol_h = 10
    tol_s = 30 
    tol_v = 50 

    # Special handling for Gray/White/Black (Low Saturation)
    mean_s = np.mean(sample_region_hsv[:,:,1])
    
    if mean_s < 40: # It is likely Gray/White
        # If it's gray, ignore HUE completely (Hue is unstable in gray)
        lower_bound = np.array([0, max(0, s_min - tol_s), max(0, v_min - tol_v)])
        upper_bound = np.array([180, min(255, s_max + tol_s), min(255, v_max + tol_v)])
    else:
        # It is a color (Red, Blue, etc.)
        lower_bound = np.array([max(0, h_min - tol_h), max(0, s_min - tol_s), max(0, v_min - tol_v)])
        upper_bound = np.array([min(180, h_max + tol_h), min(255, s_max + tol_s), min(255, v_max + tol_v)])

    # 3. Create the mask
    mask = cv2.inRange(full_img_hsv, lower_bound, upper_bound)
    return mask

@app.route('/extract-legend-image', methods=['POST'])
def extract_legend_image():
    try:
        data = request.json
        filename = data.get('filename')
        bounds = data.get('bounds')  # {x, y, width, height}
        
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        img = cv2.imread(filepath)
        
        if img is None:
            return jsonify({'error': 'Could not read image'}), 400
        
        # Extract the region
        x, y, w, h = bounds['x'], bounds['y'], bounds['width'], bounds['height']
        legend_img = img[y:y+h, x:x+w]
        
        # Save the extracted legend
        legend_filename = f"legend_{bounds['x']}_{bounds['y']}.png"
        legend_path = os.path.join(app.config['UPLOAD_FOLDER'], legend_filename)
        cv2.imwrite(legend_path, legend_img)
        
        return jsonify({
            'success': True,
            'legend_image': legend_filename
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/extract-unique-legends', methods=['POST'])
def extract_unique_legends():
    try:
        data = request.json
        filename = data.get('filename')
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        
        img = cv2.imread(filepath)
        if img is None:
            return jsonify({'error': 'Could not read image file'}), 400
            
        hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
        
        color_ranges = {
            'red': ([0, 100, 100], [10, 255, 255]),
            'red2': ([170, 100, 100], [180, 255, 255]),
            'green': ([35, 50, 50], [85, 255, 255]),
            'blue': ([95, 50, 50], [135, 255, 255]),
            'orange': ([8, 100, 100], [25, 255, 255]),
            'pink': ([145, 50, 50], [175, 255, 255]),
            'cyan': ([80, 50, 50], [100, 255, 255]),
            'yellow': ([20, 100, 100], [35, 255, 255]),
            'purple': ([125, 50, 50], [145, 255, 255])
        }
        
        all_legends = []
        legend_id = 0
        
        for color_name, (lower, upper) in color_ranges.items():
            lower = np.array(lower)
            upper = np.array(upper)
            mask = cv2.inRange(hsv, lower, upper)
            
            kernel = np.ones((3,3), np.uint8)
            mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
            mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
            
            contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            
            for contour in contours:
                area = cv2.contourArea(contour)
                if area > 50:
                    x, y, w, h = cv2.boundingRect(contour)
                    
                    if w < 10 or h < 10 or w > img.shape[1]*0.8 or h > img.shape[0]*0.8:
                        continue
                    
                    leftmost = tuple(contour[contour[:,:,0].argmin()][0])
                    rightmost = tuple(contour[contour[:,:,0].argmax()][0])
                    topmost = tuple(contour[contour[:,:,1].argmin()][0])
                    bottommost = tuple(contour[contour[:,:,1].argmax()][0])
                    
                    width_pixels = rightmost[0] - leftmost[0]
                    height_pixels = bottommost[1] - topmost[1]
                    
                    legend_preview = img[y:y+h, x:x+w]
                    preview_filename = f"legend_preview_{legend_id}.png"
                    preview_path = os.path.join(app.config['UPLOAD_FOLDER'], preview_filename)
                    cv2.imwrite(preview_path, legend_preview)
                    
                    pattern_type = detect_pattern_type(legend_preview)
                    
                    all_legends.append({
                        'id': legend_id,
                        'color': color_name.replace('2', ''),
                        'pattern': pattern_type,
                        'preview_image': preview_filename,
                        'bounds': {'x': int(x), 'y': int(y), 'width': int(w), 'height': int(h)},
                        'points': {
                            'left': [int(leftmost[0]), int(leftmost[1])],
                            'right': [int(rightmost[0]), int(rightmost[1])],
                            'top': [int(topmost[0]), int(topmost[1])],
                            'bottom': [int(bottommost[0]), int(bottommost[1])]
                        },
                        'dimensions': {
                            'width': int(width_pixels),
                            'height': int(height_pixels)
                        }
                    })
                    
                    legend_id += 1
        
        # Group similar legends
        unique_groups = group_similar_legends(all_legends)
        
        return jsonify({
            'success': True,
            'unique_groups': unique_groups,
            'total_legends': len(all_legends)
        })
        
    except Exception as e:
        print(f"Error: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500
@app.route('/measure-clicked-object', methods=['POST'])
def measure_clicked_object():
    """
    Uses Hough Line Transform to find the nearest encompassing horizontal
    and vertical lines around the click point, strictly defining the rectangular boundary.
    """
    try:
        data = request.json
        filename = data.get('filename')
        bounds = data.get('clicked_bounds') 
        
        global_click_x = int(bounds['x'] + bounds['width'] / 2)
        global_click_y = int(bounds['y'] + bounds['height'] / 2)

        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        img = cv2.imread(filepath)
        if img is None: return jsonify({'error': 'Could not read image'}), 400

        # --- STEP 1: TIGHT CROP ROI ---
        # Keep crop tight to avoid seeing too many distant lines
        crop_radius = 150 
        y1_crop = max(0, global_click_y - crop_radius)
        y2_crop = min(img.shape[0], global_click_y + crop_radius)
        x1_crop = max(0, global_click_x - crop_radius)
        x2_crop = min(img.shape[1], global_click_x + crop_radius)
        
        crop_img = img[y1_crop:y2_crop, x1_crop:x2_crop]
        crop_h, crop_w = crop_img.shape[:2]
        local_click_x = global_click_x - x1_crop
        local_click_y = global_click_y - y1_crop

        # --- STEP 2: DETECT STRUCTURAL LINES ---
        gray = cv2.cvtColor(crop_img, cv2.COLOR_BGR2GRAY)
        # Use Canny to find strong edges (walls, boundaries)
        edges = cv2.Canny(gray, 50, 150, apertureSize=3)
        
        # Use Probabilistic Hough Transform to find line segments
        # minLineLength: ignore tiny noise lines
        # maxLineGap: bridge small gaps in imperfect CAD drawings
        lines = cv2.HoughLinesP(edges, 1, np.pi/180, threshold=30, minLineLength=20, maxLineGap=10)
        
        if lines is None:
             return jsonify({'success': False, 'error': 'No structural lines found near click.'})

        horizontal_lines = []
        vertical_lines = []

        for line in lines:
            x1, y1, x2, y2 = line[0]
            # Filter for purely horizontal or vertical lines (allowing slight slight tilt)
            if abs(y1 - y2) < 5: # Horizontal
                y_pos = (y1 + y2) / 2
                # Only keep lines that span across the click X position
                if min(x1, x2) < local_click_x < max(x1, x2):
                    horizontal_lines.append(y_pos)
            elif abs(x1 - x2) < 5: # Vertical
                x_pos = (x1 + x2) / 2
                 # Only keep lines that span across the click Y position
                if min(y1, y2) < local_click_y < max(y1, y2):
                    vertical_lines.append(x_pos)

        # --- STEP 3: FIND THE ENCLOSING BOX ---
        # Initialize boundaries to the edges of the crop
        top_limit = 0
        bottom_limit = crop_h
        left_limit = 0
        right_limit = crop_w
        
        # Find nearest horizontal line ABOVE click
        above = [y for y in horizontal_lines if y < local_click_y]
        if above: top_limit = max(above)
            
        # Find nearest horizontal line BELOW click
        below = [y for y in horizontal_lines if y > local_click_y]
        if below: bottom_limit = min(below)
            
        # Find nearest vertical line LEFT of click
        left = [x for x in vertical_lines if x < local_click_x]
        if left: left_limit = max(left)
            
        # Find nearest vertical line RIGHT of click
        right = [x for x in vertical_lines if x > local_click_x]
        if right: right_limit = min(right)

        # Calculate final dimensions
        final_w = right_limit - left_limit
        final_h = bottom_limit - top_limit

        # Safety check: If box is too tiny or still huge, reject it
        if final_w < 5 or final_h < 5 or final_w > crop_w*0.9 or final_h > crop_h*0.9:
             return jsonify({'success': False, 'error': 'Could not find clear enclosed boundaries.'})

        # Determine precise length vs thickness based on orientation
        if final_w > final_h * 1.2: # Clearly horizontal wall
             precise_len = final_w
             precise_thick = final_h
             angle = 0
        elif final_h > final_w * 1.2: # Clearly vertical wall
             precise_len = final_h
             precise_thick = final_w
             angle = 90
        else: # Square-ish
             precise_len = max(final_w, final_h)
             precise_thick = min(final_w, final_h)
             angle = 0

        return jsonify({
            'success': True,
            'object': {
                'x': int(left_limit + x1_crop), 
                'y': int(top_limit + y1_crop),
                'width': int(final_w),
                'height': int(final_h),
                'precise_width': precise_thick,  # Thickness
                'precise_height': precise_len,   # Length/Main dimension
                'angle': angle
            }
        })

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500
def determine_dominant_color_improved(img_region):
    """Improved color detection focusing on actual colored pixels"""
    if img_region.size == 0:
        return 'white'
    
    # Convert to HSV and BGR for analysis
    hsv = cv2.cvtColor(img_region, cv2.COLOR_BGR2HSV)
    bgr = img_region
    
    # Calculate mean BGR values
    b_mean = np.mean(bgr[:,:,0])
    g_mean = np.mean(bgr[:,:,1])
    r_mean = np.mean(bgr[:,:,2])
    
    # Check if it's a grayscale/hatched pattern (all channels similar)
    color_diff = max(abs(b_mean - g_mean), abs(g_mean - r_mean), abs(r_mean - b_mean))
    
    # If channels are similar, it's grayscale/hatched
    if color_diff < 20:
        gray_value = (b_mean + g_mean + r_mean) / 3
        if gray_value < 60:
            return 'black'
        elif gray_value < 180:
            return 'gray'
        else:
            return 'white'
    
    # Filter out white/gray/black pixels to focus on actual colors
    mask = cv2.inRange(hsv, np.array([0, 30, 30]), np.array([180, 255, 255]))
    
    if cv2.countNonZero(mask) < 10:
        v_mean = np.mean(hsv[:,:,2])
        if v_mean < 60:
            return 'black'
        elif v_mean < 180:
            return 'gray'
        else:
            return 'white'
    
    # Get only colored pixels
    colored_pixels = hsv[mask > 0]
    
    if len(colored_pixels) == 0:
        return 'gray'
    
    h_mean = np.mean(colored_pixels[:, 0])
    s_mean = np.mean(colored_pixels[:, 1])
    v_mean = np.mean(colored_pixels[:, 2])
    
    print(f"HSV values - H: {h_mean}, S: {s_mean}, V: {v_mean}")
    
    # Better color classification
    if v_mean < 60:
        return 'black'
    elif s_mean < 40:
        return 'gray'
    elif h_mean < 15 or h_mean > 165:
        return 'red'
    elif 15 <= h_mean < 30:
        return 'orange'
    elif 30 <= h_mean < 45:
        return 'yellow'
    elif 45 <= h_mean < 80:
        return 'green'
    elif 80 <= h_mean < 100:
        return 'cyan'
    elif 100 <= h_mean < 130:
        return 'blue'
    elif 130 <= h_mean < 150:
        return 'purple'
    else:
        return 'pink'

def get_color_ranges_for_detection(color_name):
    """Get only relevant color ranges for the detected color"""
    all_ranges = {
        'red': ([0, 80, 80], [10, 255, 255]),
        'red2': ([165, 80, 80], [180, 255, 255]),
        'orange': ([10, 80, 80], [30, 255, 255]),
        'yellow': ([30, 80, 80], [45, 255, 255]),
        'green': ([45, 50, 50], [80, 255, 255]),
        'cyan': ([80, 50, 50], [100, 255, 255]),
        'blue': ([100, 50, 50], [130, 255, 255]),
        'purple': ([130, 50, 50], [150, 255, 255]),
        'pink': ([150, 50, 50], [165, 255, 255]),
        'black': ([0, 0, 0], [180, 255, 60]),
        'gray': ([0, 0, 60], [180, 50, 180]),  # Updated range for gray hatching
        'white': ([0, 0, 180], [180, 50, 255])
    }
    
    # Return only the relevant color range
    if color_name in all_ranges:
        if color_name == 'red':
            return {'red': all_ranges['red'], 'red2': all_ranges['red2']}
        else:
            return {color_name: all_ranges[color_name]}
    
    return all_ranges

@app.route('/get-edge-points', methods=['POST'])
def get_edge_points():
    try:
        data = request.json
        filename = data.get('filename')
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        
        img = cv2.imread(filepath)
        if img is None:
            return jsonify({'error': 'Could not read image'}), 400
        
        # Convert to grayscale
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        
        # Apply edge detection
        edges = cv2.Canny(gray, 50, 150, apertureSize=3)
        
        # Dilate edges slightly to make them more detectable
        kernel = np.ones((2,2), np.uint8)
        edges = cv2.dilate(edges, kernel, iterations=1)
        
        # Find all edge points
        edge_points = np.argwhere(edges > 0)
        
        # Convert to list of [x, y] coordinates
        edge_coords = [[int(pt[1]), int(pt[0])] for pt in edge_points]
        
        return jsonify({
            'success': True,
            'edge_points': edge_coords,
            'total_edges': len(edge_coords)
        })
        
    except Exception as e:
        print(f"Error: {str(e)}")
        return jsonify({'error': str(e)}), 500


def group_similar_legends(legends):
    """Group legends by color and pattern similarity"""
    groups = {}
    
    for legend in legends:
        key = f"{legend['color']}_{legend['pattern']}"
        
        if key not in groups:
            groups[key] = {
                'group_id': key,
                'color': legend['color'],
                'pattern': legend['pattern'],
                'sample_image': legend['preview_image'],
                'count': 0,
                'instances': []
            }
        
        groups[key]['count'] += 1
        groups[key]['instances'].append(legend)
    
    return list(groups.values())


# --- Main entry point to run the app ---
if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
