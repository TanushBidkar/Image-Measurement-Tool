# AI Image Measurement Tool

A web-based tool for measuring objects in images using AI and computer vision.

## Features
- Upload images (drag & drop or click)
- Calibrate scale using reference objects
- Real-time measurement in feet
- Interactive cursor-based measurements
- Multiple measurement tracking
- Export measurement data

## Setup Instructions

### 1. Install Python 3.8+
Download from https://python.org/downloads/

### 2. Clone/Download Project
Download and extract the project to your local machine

### 3. Set Up Virtual Environment (Recommended)
```bash
# Create virtual environment
python -m venv venv

# Activate virtual environment
# On Windows:
venv\Scripts\activate
# On macOS/Linux:
source venv/bin/activate
```

### 4. Install Dependencies
```bash
pip install -r requirements.txt
```

### 5. Run the Application
```bash
python app.py
```

### 6. Access the Application
Open your web browser and navigate to:
```
http://localhost:5000
```

## Usage
1. Upload an image using drag & drop or click to browse
2. Set the calibration by drawing a line on a known object and entering its length in feet
3. Start measuring objects by clicking and dragging
4. View measurements in the list below the image

## Supported File Types
- JPG/JPEG
- PNG
- WebP

## Size Limits
- Maximum file size: 16MB
