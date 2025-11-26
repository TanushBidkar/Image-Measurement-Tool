class ProfessionalImageMeasurementTool {
    constructor() {
        this.canvas = null;
        this.ctx = null;
        this.image = null;
        this.isCalibrating = false;
        this.isMeasuring = false;
        this.startPoint = null;
        this.measurements = [];
        this.calibrationPoints = null;
        this.isCalibrated = false;
        this.currentScale = 1.0;
        this.panOffset = { x: 0, y: 0 };
        this.isPanning = false;
        this.lastPanPoint = { x: 0, y: 0 };
        this.selectedMeasurement = null;
        this.measurementIdCounter = 0;
        this.pixelsPerUnit = 1.0;
        this.isDrawing = false;
        this.currentGroupName = '';
        this.measurementHistory = [];
        this.historyIndex = -1;
        this.autoDetectMode = false;
        this.detectedLegends = [];
        this.legendGroups = {};
        this.currentFilename = '';
        this.edgePoints = [];
    this.snapEnabled = true;
    this.snapRadius = 15; // pixels
    this.clickDetectionMode = false;
this.pendingGroupName = '';
    this.showSnapPreview = true;
    this.nearestSnapPoint = null;
        
        this.init();
    }
    
    init() {
        this.setupEventListeners();
        this.showUploadOverlay();
    }
    
    setupEventListeners() {
        // Upload functionality
        const uploadBtn = document.getElementById('uploadBtn');
        const uploadOverlay = document.getElementById('uploadOverlay');
        const imageInput = document.getElementById('imageInput');
        const uploadModal = document.querySelector('.upload-modal');
        const viewByGroupBtn = document.getElementById('viewByGroupBtn');
if (viewByGroupBtn) viewByGroupBtn.addEventListener('click', () => this.viewByGroup());
        
        uploadBtn.addEventListener('click', () => this.showUploadOverlay());
        uploadOverlay.addEventListener('click', (e) => {
            if (e.target === uploadOverlay) this.hideUploadOverlay();
        });
        
        uploadModal.addEventListener('click', (e) => {
            e.stopPropagation();
            imageInput.click();
        });
        
        uploadModal.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadModal.style.background = '#e3f2fd';
        });
        uploadModal.addEventListener('dragleave', () => {
            uploadModal.style.background = 'white';
        });
        uploadModal.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            uploadModal.style.background = 'white';
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                this.handleFileUpload(files[0]);
            }
        });
        
        imageInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                this.handleFileUpload(e.target.files[0]);
            }
        });
        
        // Zoom controls
        document.getElementById('zoomInBtn').addEventListener('click', () => this.zoomIn());
        document.getElementById('zoomOutBtn').addEventListener('click', () => this.zoomOut());
        document.getElementById('resetZoomBtn').addEventListener('click', () => this.resetZoom());
        
        // Calibration controls
        document.getElementById('setCalibrateBtn').addEventListener('click', () => this.startCalibration());
        document.getElementById('confirmCalibrationBtn').addEventListener('click', () => this.confirmCalibration());
        
        // Measurement controls
        document.getElementById('measureBtn').addEventListener('click', () => this.startMeasuring());
        document.getElementById('clearAllBtn').addEventListener('click', () => this.clearAllMeasurements());
        // Snap toggle
const toggleSnapBtn = document.getElementById('toggleSnapBtn');
if (toggleSnapBtn) {
    toggleSnapBtn.addEventListener('click', () => {
        this.snapEnabled = !this.snapEnabled;
        toggleSnapBtn.textContent = this.snapEnabled ? '🧲 Snap: ON' : '🧲 Snap: OFF';
        toggleSnapBtn.style.background = this.snapEnabled ? 
            'linear-gradient(135deg, #27ae60, #2ecc71)' : 
            'linear-gradient(135deg, #95a5a6, #7f8c8d)';
        this.updateTooltip(this.snapEnabled ? 'Snap enabled' : 'Snap disabled');
    });
}

// Snap radius adjustment
const snapRadiusInput = document.getElementById('snapRadius');
if (snapRadiusInput) {
    snapRadiusInput.addEventListener('input', (e) => {
        this.snapRadius = parseInt(e.target.value);
        document.getElementById('snapRadiusValue').textContent = this.snapRadius + 'px';
    });
}
        // Legend detection controls
        const autoDetectBtn = document.getElementById('autoDetectBtn');
        const viewLegendsBtn = document.getElementById('viewLegendsBtn');
        // Toggle measurements visibility
const toggleMeasurementsBtn = document.getElementById('toggleMeasurementsBtn');
if (toggleMeasurementsBtn) {
    toggleMeasurementsBtn.addEventListener('click', () => {
        const isHidden = toggleMeasurementsBtn.dataset.hidden === 'true';
        toggleMeasurementsBtn.dataset.hidden = !isHidden;
        toggleMeasurementsBtn.textContent = isHidden ? '👁️ Hide Measurements' : '👁️ Show Measurements';
        toggleMeasurementsBtn.style.background = isHidden ? 'linear-gradient(135deg, #e74c3c, #c0392b)' : 'linear-gradient(135deg, #27ae60, #2ecc71)';
        this.toggleMeasurements(isHidden);
    });
}

// Click-to-measure mode - MOVED OUTSIDE
const clickMeasureBtn = document.createElement('button');
clickMeasureBtn.id = 'clickMeasureBtn';
clickMeasureBtn.className = 'btn-primary';
clickMeasureBtn.textContent = '🎯 Click Legend to Measure';
clickMeasureBtn.style.display = 'none';
document.querySelector('.panel-section:nth-child(3)').appendChild(clickMeasureBtn);

clickMeasureBtn.addEventListener('click', () => this.startClickMeasurement());
        if (autoDetectBtn) autoDetectBtn.addEventListener('click', () => this.detectLegends());
        if (viewLegendsBtn) viewLegendsBtn.addEventListener('click', () => this.showLegendsView());
        
        // Undo/Redo controls
        const undoBtn = document.getElementById('undoBtn');
        const redoBtn = document.getElementById('redoBtn');
        if (undoBtn) undoBtn.addEventListener('click', () => this.undo());
        if (redoBtn) redoBtn.addEventListener('click', () => this.redo());
        
        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => this.handleKeyboard(e));
    }
    
    showUploadOverlay() {
        document.getElementById('uploadOverlay').style.display = 'flex';
    }
    
    hideUploadOverlay() {
        document.getElementById('uploadOverlay').style.display = 'none';
    }
    
    async handleFileUpload(file) {
        const formData = new FormData();
        formData.append('file', file);
        
        try {
            // Show loading
            document.querySelector('.upload-content h2').textContent = 'Processing...';
            
            const response = await fetch('/upload', {
                method: 'POST',
                body: formData
            });
            
            const result = await response.json();
            
            if (result.success) {
                this.hideUploadOverlay();
                this.currentFilename = result.filename;
                this.loadImage(result.filename);
                document.getElementById('sidePanel').style.display = 'block';
            } else {
                alert('Upload failed: ' + result.error);
                document.querySelector('.upload-content h2').textContent = 'Upload Image';
            }
        } catch (error) {
            alert('Upload failed: ' + error.message);
            document.querySelector('.upload-content h2').textContent = 'Upload Image';
        }

    }
    
    
    loadImage(filename) {
    const img = new Image();
    img.onload = () => {
        this.image = img;
        console.log('Image loaded:', img.width, 'x', img.height);
        this.setupCanvas();
        this.resetZoom();
        this.updateTooltip('Ready to calibrate');
        
        // Force redraw
        setTimeout(() => {
            this.drawImage();
        }, 100);
        
        // NEW: Load edge detection
        this.loadEdgeDetection();
    };
    img.onerror = () => {
        console.error('Failed to load image:', filename);
        alert('Failed to load image. Please try again.');
    };
    img.src = `/uploads/${filename}?t=${Date.now()}`;
}
    async loadEdgeDetection() {
    if (!this.currentFilename) return;
    
    try {
        const response = await fetch('/get-edge-points', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename: this.currentFilename })
        });
        
        const result = await response.json();
        
        if (result.success) {
            this.edgePoints = result.edge_points;
            console.log(`Loaded ${result.total_edges} edge points for snapping`);
            this.updateTooltip(`Edge detection ready: ${result.total_edges} snap points`);
        }
    } catch (error) {
        console.error('Edge detection failed:', error);
    }
}
    setupCanvas() {
        this.canvas = document.getElementById('imageCanvas');
        this.ctx = this.canvas.getContext('2d');
        
        // Set canvas to actual image size for high resolution
        this.canvas.width = this.image.width;
        this.canvas.height = this.image.height;
        
        // Calculate display size while maintaining aspect ratio
        const maxWidth = window.innerWidth - 400; // Account for sidebar
        const maxHeight = window.innerHeight - 120; // Account for toolbar and padding
        
        let displayWidth = Math.min(maxWidth, this.image.width);
        let displayHeight = (displayWidth / this.image.width) * this.image.height;
        
        if (displayHeight > maxHeight) {
            displayHeight = maxHeight;
            displayWidth = (displayHeight / this.image.height) * this.image.width;
        }
        
        // Set CSS size for proper display
        this.canvas.style.width = displayWidth + 'px';
        this.canvas.style.height = displayHeight + 'px';
        this.canvas.style.display = 'block';
        
        console.log('Canvas setup:', this.canvas.width, 'x', this.canvas.height, 'display:', displayWidth, 'x', displayHeight);
        
        this.drawImage();
        this.setupCanvasEvents();
    }
    
    setupCanvasEvents() {
        // Mouse events
        this.canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
        this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        this.canvas.addEventListener('mouseup', (e) => this.handleMouseUp(e));
        
        // Touch events for mobile
        this.canvas.addEventListener('touchstart', (e) => this.handleTouchStart(e), { passive: false });
        this.canvas.addEventListener('touchmove', (e) => this.handleTouchMove(e), { passive: false });
        this.canvas.addEventListener('touchend', (e) => this.handleTouchEnd(e), { passive: false });
        
        // Zoom with mouse wheel
        this.canvas.addEventListener('wheel', (e) => this.handleWheel(e), { passive: false });
        
        // Context menu disable
        this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    }
    
    getCanvasPoint(e) {
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = this.canvas.width / rect.width;
        const scaleY = this.canvas.height / rect.height;
        
        return {
            x: (e.clientX - rect.left) * scaleX,
            y: (e.clientY - rect.top) * scaleY
        };
    }
    findNearestEdge(point) {
    if (!this.snapEnabled || this.edgePoints.length === 0) {
        return point;
    }
    
    let minDistance = this.snapRadius;
    let nearestPoint = null;
    
    // Search in a local area for performance
    for (let i = 0; i < this.edgePoints.length; i++) {
        const edge = this.edgePoints[i];
        const dx = edge[0] - point.x;
        const dy = edge[1] - point.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance < minDistance) {
            minDistance = distance;
            nearestPoint = { x: edge[0], y: edge[1] };
        }
        
        // Performance optimization: skip if too far
        if (Math.abs(dx) > this.snapRadius && Math.abs(dy) > this.snapRadius) {
            continue;
        }
    }
    
    this.nearestSnapPoint = nearestPoint;
    return nearestPoint || point;
}
    
  handleMouseDown(e) {
    if (e.button !== 0) return;
    
    const point = this.getCanvasPoint(e);
    
    // Handle click detection mode
    if (this.clickDetectionMode) {
        this.handleCanvasClick(point);
        return;
    }
    
    const snappedPoint = this.findNearestEdge(point);
    
    if (this.isCalibrating || this.isMeasuring) {
        this.startPoint = snappedPoint;
        this.isDrawing = true;
    } else if (e.altKey || e.button === 1) {
        this.isPanning = true;
        this.lastPanPoint = { x: e.clientX, y: e.clientY };
        document.querySelector('.canvas-container').classList.add('grabbing');
    }
}
    handleMouseMove(e) {
    if (this.isPanning) {
        const dx = e.clientX - this.lastPanPoint.x;
        const dy = e.clientY - this.lastPanPoint.y;
        
        const container = document.querySelector('.canvas-container');
        container.scrollLeft -= dx;
        container.scrollTop -= dy;
        
        this.lastPanPoint = { x: e.clientX, y: e.clientY };
        return;
    }
    
    const point = this.getCanvasPoint(e);
    const snappedPoint = this.findNearestEdge(point);
    
    if (this.isDrawing && this.startPoint) {
        this.redrawCanvas();
        this.drawMeasurementLine(this.startPoint, snappedPoint, this.isCalibrating ? '#e74c3c' : '#27ae60');
        
        const distance = this.calculateDistance(this.startPoint, snappedPoint);
        let displayText = `${distance.toFixed(1)} pixels`;
        
        if (this.isCalibrated && !this.isCalibrating) {
            const realDistance = this.pixelsToFeet(distance);
            displayText = `${realDistance.toFixed(2)} feet`;
        }
        
        this.updateTooltip(displayText);
        
        // Show snap preview
        if (this.showSnapPreview && this.nearestSnapPoint) {
            this.drawSnapPreview(snappedPoint);
        }
    } else if ((this.isCalibrating || this.isMeasuring) && this.showSnapPreview && this.nearestSnapPoint) {
        // Show snap preview even when not drawing
        this.redrawCanvas();
        this.drawSnapPreview(snappedPoint);
    }
}
    

handleMouseUp(e) {
    if (this.isPanning) {
        this.isPanning = false;
        document.querySelector('.canvas-container').classList.remove('grabbing');
    }
    
    if (!this.isDrawing || !this.startPoint) return;
    
    const point = this.getCanvasPoint(e);
    const snappedPoint = this.findNearestEdge(point);
    const distance = this.calculateDistance(this.startPoint, snappedPoint);
    
    if (distance < 10) {
        this.isDrawing = false;
        return;
    }
    
    if (this.isCalibrating) {
        this.calibrationPoints = { start: this.startPoint, end: snappedPoint };
        document.getElementById('confirmCalibrationBtn').style.display = 'inline-block';
        this.updateTooltip('Calibration line set. Click Confirm Calibration.');
    } else if (this.isMeasuring) {
        this.addMeasurement(this.startPoint, snappedPoint);
    }
    
    this.isDrawing = false;
    this.startPoint = null;
    this.nearestSnapPoint = null;
}
    
    handleWheel(e) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        this.zoom(delta, this.getCanvasPoint(e));
    }
    
    handleKeyboard(e) {
        switch(e.key) {
            case 'Escape':
                this.cancelCurrentOperation();
                break;
            case 'Delete':
                if (this.selectedMeasurement) {
                    this.deleteMeasurement(this.selectedMeasurement);
                }
                break;
            case '+':
            case '=':
                this.zoomIn();
                break;
            case '-':
                this.zoomOut();
                break;
            case 'z':
                if (e.ctrlKey || e.metaKey) {
                    e.preventDefault();
                    if (e.shiftKey) {
                        this.redo();
                    } else {
                        this.undo();
                    }
                }
                break;
            case 'y':
                if (e.ctrlKey || e.metaKey) {
                    e.preventDefault();
                    this.redo();
                }
                break;
        }
    }
    
    // Zoom functionality
    zoomIn() {
        this.zoom(1.2);
    }
    
    zoomOut() {
        this.zoom(0.8);
    }
    
    resetZoom() {
        this.currentScale = 1.0;
        this.panOffset = { x: 0, y: 0 };
        this.updateCanvasTransform();
        this.updateZoomDisplay();
    }
    
    zoom(factor, center = null) {
        const newScale = Math.max(0.1, Math.min(5.0, this.currentScale * factor));
        const container = document.querySelector('.canvas-container');
        const wrapper = document.querySelector('.canvas-wrapper');
        
        // Store scroll position relative to content
        const scrollXRatio = container.scrollLeft / (wrapper.offsetWidth * this.currentScale);
        const scrollYRatio = container.scrollTop / (wrapper.offsetHeight * this.currentScale);
        
        this.currentScale = newScale;
        wrapper.style.transform = `scale(${this.currentScale})`;
        
        // Restore scroll position
        requestAnimationFrame(() => {
            container.scrollLeft = wrapper.offsetWidth * this.currentScale * scrollXRatio;
            container.scrollTop = wrapper.offsetHeight * this.currentScale * scrollYRatio;
        });
        
        this.updateZoomDisplay();
    }
    
    updateCanvasTransform() {
        this.canvas.style.transform = `scale(${this.currentScale}) translate(${this.panOffset.x}px, ${this.panOffset.y}px)`;
    }
    
    updateZoomDisplay() {
        document.getElementById('zoomLevel').textContent = `${Math.round(this.currentScale * 100)}%`;
    }
    
    // Drawing functions
    drawImage() {
        if (!this.image || !this.ctx) {
            console.error('Cannot draw - missing image or context');
            return;
        }
        
        console.log('Drawing image:', this.image.width, 'x', this.image.height);
        
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Fill with white background
        this.ctx.fillStyle = 'white';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Draw the image
        this.ctx.drawImage(this.image, 0, 0);
        
        console.log('Image drawn successfully');
    }
    
    redrawCanvas() {
        this.drawImage();
        
        // Redraw calibration line
        if (this.calibrationPoints && this.isCalibrated) {
            this.drawMeasurementLine(this.calibrationPoints.start, this.calibrationPoints.end, '#e74c3c');
            this.drawMeasurementLabel(this.calibrationPoints, 'CAL');
        }
        
        // Highlight detected legends
        if (this.detectedLegends.length > 0) {
            this.detectedLegends.forEach(legend => {
                this.ctx.strokeStyle = legend.color;
                this.ctx.lineWidth = 3;
                this.ctx.setLineDash([10, 5]);
                this.ctx.strokeRect(legend.bounds.x, legend.bounds.y, legend.bounds.width, legend.bounds.height);
                this.ctx.setLineDash([]);
            });
        }
        
        // Redraw measurements
        // Redraw measurements
this.measurements.forEach((measurement, index) => {
    const color = measurement.id === this.selectedMeasurement ? '#f39c12' : '#27ae60';
    const showArrows = measurement.showArrows || false;
    this.drawMeasurementLine(measurement.line.start, measurement.line.end, color, 3, showArrows);
    this.drawMeasurementLabel(measurement.line, `${measurement.realDistance.toFixed(2)} ft`);
});
    }
    
   drawMeasurementLine(start, end, color = '#27ae60', width = 3, showArrows = false) {
    // Main line
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = width;
    this.ctx.lineCap = 'round';
    this.ctx.setLineDash([]);
    
    this.ctx.beginPath();
    this.ctx.moveTo(start.x, start.y);
    this.ctx.lineTo(end.x, end.y);
    this.ctx.stroke();
    
    // Endpoints
    this.drawMeasurementPoint(start, color);
    this.drawMeasurementPoint(end, color);
    
    // Extension lines
    this.drawExtensionLines(start, end, color);
    
    // Draw arrows if requested
    if (showArrows) {
        this.drawDimensionArrows(start, end, color);
    }
}

drawDimensionArrows(start, end, color) {
    const angle = Math.atan2(end.y - start.y, end.x - start.x);
    const arrowLength = 15;
    const arrowWidth = 8;
    
    // Arrow at start point (pointing away from line)
    this.ctx.fillStyle = color;
    this.ctx.beginPath();
    this.ctx.moveTo(start.x, start.y);
    this.ctx.lineTo(
        start.x - arrowLength * Math.cos(angle) + arrowWidth * Math.sin(angle),
        start.y - arrowLength * Math.sin(angle) - arrowWidth * Math.cos(angle)
    );
    this.ctx.lineTo(
        start.x - arrowLength * Math.cos(angle) - arrowWidth * Math.sin(angle),
        start.y - arrowLength * Math.sin(angle) + arrowWidth * Math.cos(angle)
    );
    this.ctx.closePath();
    this.ctx.fill();
    
    // Arrow at end point (pointing away from line)
    this.ctx.beginPath();
    this.ctx.moveTo(end.x, end.y);
    this.ctx.lineTo(
        end.x + arrowLength * Math.cos(angle) + arrowWidth * Math.sin(angle),
        end.y + arrowLength * Math.sin(angle) - arrowWidth * Math.cos(angle)
    );
    this.ctx.lineTo(
        end.x + arrowLength * Math.cos(angle) - arrowWidth * Math.sin(angle),
        end.y + arrowLength * Math.sin(angle) + arrowWidth * Math.cos(angle)
    );
    this.ctx.closePath();
    this.ctx.fill();
}
    drawMeasurementPoint(point, color) {
    const size = 6; // Smaller size
    
    // Outer circle
    this.ctx.fillStyle = color;
    this.ctx.beginPath();
    this.ctx.arc(point.x, point.y, size, 0, 2 * Math.PI);
    this.ctx.fill();
    
    // Inner circle
    this.ctx.fillStyle = 'white';
    this.ctx.beginPath();
    this.ctx.arc(point.x, point.y, size - 2, 0, 2 * Math.PI);
    this.ctx.fill();
}
    
    drawExtensionLines(start, end, color) {
    const extLength = 15; // Shorter extension lines
    const angle = Math.atan2(end.y - start.y, end.x - start.x);
    const perpAngle = angle + Math.PI / 2;
    
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = 1;
    this.ctx.setLineDash([3, 3]);
    
    // Extension lines at start point
    this.ctx.beginPath();
    this.ctx.moveTo(start.x + Math.cos(perpAngle) * extLength, start.y + Math.sin(perpAngle) * extLength);
    this.ctx.lineTo(start.x - Math.cos(perpAngle) * extLength, start.y - Math.sin(perpAngle) * extLength);
    this.ctx.stroke();
    
    // Extension lines at end point
    this.ctx.beginPath();
    this.ctx.moveTo(end.x + Math.cos(perpAngle) * extLength, end.y + Math.sin(perpAngle) * extLength);
    this.ctx.lineTo(end.x - Math.cos(perpAngle) * extLength, end.y - Math.sin(perpAngle) * extLength);
    this.ctx.stroke();
    
    this.ctx.setLineDash([]);
}
    drawSnapPreview(point) {
    // Draw a bright indicator circle at snap point
    this.ctx.save();
    
    // Outer glow
    this.ctx.strokeStyle = '#00ff00';
    this.ctx.lineWidth = 3;
    this.ctx.globalAlpha = 0.6;
    this.ctx.beginPath();
    this.ctx.arc(point.x, point.y, 12, 0, 2 * Math.PI);
    this.ctx.stroke();
    
    // Inner circle
    this.ctx.fillStyle = '#00ff00';
    this.ctx.globalAlpha = 0.8;
    this.ctx.beginPath();
    this.ctx.arc(point.x, point.y, 4, 0, 2 * Math.PI);
    this.ctx.fill();
    
    // Crosshair
    this.ctx.strokeStyle = '#00ff00';
    this.ctx.lineWidth = 2;
    this.ctx.globalAlpha = 1.0;
    this.ctx.beginPath();
    this.ctx.moveTo(point.x - 8, point.y);
    this.ctx.lineTo(point.x + 8, point.y);
    this.ctx.moveTo(point.x, point.y - 8);
    this.ctx.lineTo(point.x, point.y + 8);
    this.ctx.stroke();
    
    this.ctx.restore();
}
    drawMeasurementLabel(line, text) {
    const midX = (line.start.x + line.end.x) / 2;
    const midY = (line.start.y + line.end.y) / 2;

    // Calculate angle of the line
    const angle = Math.atan2(line.end.y - line.start.y, line.end.x - line.start.x);
    
    // Offset label perpendicular to line to avoid overlap
    const offsetDistance = 30;
    const offsetX = Math.cos(angle + Math.PI/2) * offsetDistance;
    const offsetY = Math.sin(angle + Math.PI/2) * offsetDistance;
    
    const labelX = midX + offsetX;
    const labelY = midY + offsetY;

    // Smaller, more compact label
    this.ctx.save();
    this.ctx.globalAlpha = 0.95;
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
    const textFont = 'bold 16px Arial';
    this.ctx.font = textFont;
    const textWidth = this.ctx.measureText(text).width + 16;
    const textHeight = 28;
    
    this.ctx.fillRect(labelX - textWidth/2, labelY - textHeight/2, textWidth, textHeight);
    this.ctx.globalAlpha = 1.0;

    // White border for contrast
    this.ctx.strokeStyle = 'white';
    this.ctx.lineWidth = 1.5;
    this.ctx.strokeRect(labelX - textWidth/2, labelY - textHeight/2, textWidth, textHeight);

    // Draw measurement value - bright yellow
    this.ctx.font = textFont;
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.shadowColor = 'black';
    this.ctx.shadowBlur = 4;
    this.ctx.fillStyle = '#ffe600';
    this.ctx.fillText(text, labelX, labelY);
    this.ctx.shadowBlur = 0;
    this.ctx.restore();
}
    // Legend Detection Functions
    async detectLegends() {
    if (!this.isCalibrated) {
        alert('Please calibrate first!');
        return;
    }
    
    if (!this.currentFilename) {
        alert('No image loaded!');
        return;
    }
    
    this.updateTooltip('Extracting unique legends... Please wait.');
    
    try {
        const response = await fetch('/extract-unique-legends', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename: this.currentFilename })
        });
        
        const result = await response.json();
        
        if (result.success) {
            this.showLegendSelectionModal(result.unique_groups);
            this.updateTooltip(`Found ${result.total_legends} legends in ${result.unique_groups.length} groups!`);
        } else {
            alert('Legend extraction failed: ' + result.error);
        }
    } catch (error) {
        alert('Legend extraction failed: ' + error.message);
        this.updateTooltip('Legend extraction failed');
    }
}
    processSelectedLegends(selectedGroups) {
    this.legendGroups = {};
    this.detectedLegends = [];
    
    selectedGroups.forEach(group => {
        const groupKey = group.group_id;
        const displayName = `${group.color.charAt(0).toUpperCase() + group.color.slice(1)} ${group.pattern}`;
        
        this.legendGroups[groupKey] = {
            name: displayName,
            color: group.color,
            pattern: group.pattern,
            previewImage: group.sample_image,
            items: [],
            total: 0
        };
        
        group.instances.forEach((legend, index) => {
            this.detectedLegends.push(legend);
            
            const widthMeasurement = {
                id: ++this.measurementIdCounter,
                line: {
                    start: { x: legend.points.left[0], y: legend.points.left[1] },
                    end: { x: legend.points.right[0], y: legend.points.right[1] }
                },
                pixelDistance: legend.dimensions.width,
                realDistance: this.pixelsToFeet(legend.dimensions.width),
                group: groupKey,
                type: 'width',
                autoDetected: true,
                name: `${displayName} - Width #${index + 1}`,
                legendBounds: legend.bounds,
                previewImage: legend.preview_image
            };
            
            const heightMeasurement = {
                id: ++this.measurementIdCounter,
                line: {
                    start: { x: legend.points.top[0], y: legend.points.top[1] },
                    end: { x: legend.points.bottom[0], y: legend.points.bottom[1] }
                },
                pixelDistance: legend.dimensions.height,
                realDistance: this.pixelsToFeet(legend.dimensions.height),
                group: groupKey,
                type: 'height',
                autoDetected: true,
                name: `${displayName} - Height #${index + 1}`,
                legendBounds: legend.bounds,
                previewImage: legend.preview_image
            };
            
            this.measurements.push(widthMeasurement);
            this.measurements.push(heightMeasurement);
            
            this.legendGroups[groupKey].items.push(widthMeasurement, heightMeasurement);
            this.legendGroups[groupKey].total += widthMeasurement.realDistance + heightMeasurement.realDistance;
        });
    });
    
    this.saveToHistory();
    this.updateMeasurementsList();
    this.redrawCanvas();
    this.updateLegendGroupsDisplay();
    
    this.updateTooltip(`Measured ${this.detectedLegends.length} selected legends!`);
}

showLegendSelectionModal(uniqueGroups) {
    const modal = document.createElement('div');
    modal.className = 'legends-modal';
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.95);
        z-index: 3000;
        overflow-y: auto;
        padding: 20px;
    `;
    
    let content = `
        <div style="background:white; max-width:1400px; margin:0 auto; padding:30px; border-radius:10px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:30px;">
                <h2 style="margin:0;">🎨 Select Legends to Measure</h2>
                <div>
                    <button id="confirmSelectionBtn" 
                            style="padding:12px 24px; background:#27ae60; color:white; border:none; border-radius:5px; cursor:pointer; font-weight:600; margin-right:10px;">
                        ✓ Measure Selected
                    </button>
                    <button onclick="this.closest('.legends-modal').remove()" 
                            style="padding:12px 24px; background:#e74c3c; color:white; border:none; border-radius:5px; cursor:pointer; font-weight:600;">
                        ✕ Cancel
                    </button>
                </div>
            </div>
            <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap:20px;" id="legendSelectionGrid">
    `;
    
    uniqueGroups.forEach((group, idx) => {
        content += `
            <div class="legend-selection-card" style="background:#f8f9fa; padding:20px; border-radius:8px; border:3px solid #ddd; cursor:pointer; transition: all 0.3s ease;"
                 data-group-index="${idx}">
                <div style="text-align:center; margin-bottom:15px;">
                    <img src="/uploads/${group.sample_image}" 
                         style="width:100%; max-width:150px; height:100px; object-fit:contain; border:2px solid #ddd; border-radius:4px; background:white; padding:10px;" />
                </div>
                <h3 style="color:${group.color}; text-align:center; margin-bottom:10px;">
                    ${group.color.charAt(0).toUpperCase() + group.color.slice(1)} ${group.pattern}
                </h3>
                <div style="background:white; padding:10px; border-radius:6px; text-align:center;">
                    <strong>Found:</strong> ${group.count} instances
                </div>
                <div style="text-align:center; margin-top:15px;">
                    <input type="checkbox" class="legend-checkbox" data-group-index="${idx}" 
                           style="width:20px; height:20px; cursor:pointer;">
                    <label style="margin-left:8px; font-weight:600;">Select this legend</label>
                </div>
            </div>
        `;
    });
    
    content += '</div></div>';
    modal.innerHTML = content;
    document.body.appendChild(modal);
    
    // Add click handlers
    document.querySelectorAll('.legend-selection-card').forEach(card => {
        card.addEventListener('click', (e) => {
            if (e.target.type !== 'checkbox') {
                const checkbox = card.querySelector('.legend-checkbox');
                checkbox.checked = !checkbox.checked;
            }
            
            if (card.querySelector('.legend-checkbox').checked) {
                card.style.borderColor = '#27ae60';
                card.style.background = '#d4edda';
            } else {
                card.style.borderColor = '#ddd';
                card.style.background = '#f8f9fa';
            }
        });
    });
    
    document.getElementById('confirmSelectionBtn').addEventListener('click', () => {
        const selectedGroups = [];
        document.querySelectorAll('.legend-checkbox:checked').forEach(checkbox => {
            const index = parseInt(checkbox.dataset.groupIndex);
            selectedGroups.push(uniqueGroups[index]);
        });
        
        if (selectedGroups.length === 0) {
            alert('Please select at least one legend group!');
            return;
        }
        
        modal.remove();
        this.processSelectedLegends(selectedGroups);
    });
}
    updateLegendGroupsDisplay() {
    const container = document.getElementById('legendGroupsContainer');
    if (!container) return;
    
    container.innerHTML = '<h4 style="margin-bottom:10px;">Legend Groups:</h4>';
    
    if (Object.keys(this.legendGroups).length === 0) {
        container.innerHTML += '<p style="color:#95a5a6; font-style:italic; text-align:center;">No legends detected yet</p>';
        return;
    }
    
    Object.keys(this.legendGroups).forEach(groupKey => {
        const group = this.legendGroups[groupKey];
        const groupDiv = document.createElement('div');
        groupDiv.className = 'legend-group-item';
        groupDiv.style.cssText = `
            padding:12px; 
            margin:10px 0; 
            background:#f8f9fa; 
            border-left:4px solid ${group.color}; 
            border-radius:6px;
            transition: transform 0.2s ease;
        `;
        
        // Show legend preview image
        const previewImg = group.previewImage ? 
            `<img src="/uploads/${group.previewImage}" style="width:60px; height:40px; object-fit:contain; border:1px solid #ddd; border-radius:4px; margin-right:10px;" />` : 
            '';
        
        groupDiv.innerHTML = `
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;">
                <div style="display:flex; align-items:center;">
                    ${previewImg}
                    <span style="font-weight:600; color:#2c3e50;">${group.name}</span>
                </div>
                <input type="text" placeholder="Rename group" 
                       value="${group.name}"
                       style="width:120px; padding:4px 8px; border:1px solid #ddd; border-radius:4px;" 
                       onchange="tool.renameGroup('${groupKey}', this.value)">
            </div>
            <div style="display:flex; justify-content:space-between; font-size:0.9rem;">
                <small style="color:#7f8c8d;">Items: ${group.items.length}</small>
                <span style="color:#27ae60; font-weight:600;">
                    Total: ${group.total.toFixed(2)} ft
                </span>
            </div>
        `;
        
        container.appendChild(groupDiv);
    });
}

toggleMeasurements(show) {
    if (show) {
        this.redrawCanvas();
    } else {
        this.drawImage();
        // Draw calibration line only
        if (this.calibrationPoints && this.isCalibrated) {
            this.drawMeasurementLine(this.calibrationPoints.start, this.calibrationPoints.end, '#e74c3c');
        }
    }
}
    renameGroup(colorKey, newName) {
        if (newName && this.legendGroups[colorKey]) {
            this.legendGroups[colorKey].name = newName;
            
            // Update all measurements in this group
            this.measurements.forEach(m => {
                if (m.group === colorKey) {
                    m.group = newName;
                }
            });
            
            this.updateLegendGroupsDisplay();
            this.updateMeasurementsList();
        }
    }
    
    showLegendsView() {
    if (Object.keys(this.legendGroups).length === 0) {
        alert('No legends detected yet. Please use "Auto-Detect Legends" first.');
        return;
    }
    
    const modal = document.createElement('div');
    modal.className = 'legends-modal';
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.95);
        z-index: 3000;
        overflow-y: auto;
        padding: 20px;
    `;
    
    let content = `
        <div style="background:white; max-width:1400px; margin:0 auto; padding:30px; border-radius:10px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:30px;">
                <h2 style="margin:0;">📐 All Legend Measurements</h2>
                <button onclick="this.closest('.legends-modal').remove()" 
                        style="padding:10px 20px; background:#e74c3c; color:white; border:none; border-radius:5px; cursor:pointer; font-weight:600;">
                    ✕ Close
                </button>
            </div>
            <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(350px, 1fr)); gap:20px;">
    `;
    
    Object.keys(this.legendGroups).forEach(groupKey => {
        const group = this.legendGroups[groupKey];
        
        content += `
            <div style="background:#f8f9fa; padding:20px; border-radius:8px; border:3px solid ${group.color};">
                <div style="display:flex; align-items:center; margin-bottom:15px;">
                    ${group.previewImage ? `<img src="/uploads/${group.previewImage}" style="width:80px; height:60px; object-fit:contain; border:2px solid #ddd; border-radius:4px; margin-right:15px; background:white; padding:5px;" />` : ''}
                    <h3 style="margin:0; color:${group.color};">${group.name}</h3>
                </div>
                <div style="background:white; padding:15px; border-radius:6px; margin-bottom:10px;">
                    <strong>Total Measurements:</strong> ${group.items.length}<br>
                    <strong style="color:#27ae60; font-size:1.3rem;">Total: ${group.total.toFixed(2)} ft</strong>
                </div>
                <details style="cursor:pointer;">
                    <summary style="font-weight:600; padding:10px; background:white; border-radius:4px; margin-bottom:10px;">View Individual Measurements</summary>
                    <div style="padding:10px;">
        `;
        
        group.items.forEach(item => {
            content += `
                <div style="background:white; padding:10px; margin:5px 0; border-radius:4px; border-left:3px solid #3498db;">
                    <small>${item.name}</small><br>
                    <strong style="color:#27ae60;">${item.realDistance.toFixed(2)} ft</strong>
                    <span style="color:#999; font-size:0.85rem;"> (${item.pixelDistance.toFixed(1)}px)</span>
                </div>
            `;
        });
        
        content += `
                    </div>
                </details>
            </div>
        `;
    });
    
    content += '</div></div>';
    modal.innerHTML = content;
    document.body.appendChild(modal);
}
    viewByGroup() {
    if (Object.keys(this.legendGroups).length === 0) {
        alert('No legend groups available.');
        return;
    }
    
    const modal = document.createElement('div');
    modal.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.95); z-index: 3000; overflow-y: auto; padding: 20px;
    `;
    
    let content = `
        <div style="background:white; max-width:1400px; margin:0 auto; padding:30px; border-radius:10px;">
            <div style="display:flex; justify-content:space-between; margin-bottom:30px;">
                <h2>📊 Measurements by Group</h2>
                <button onclick="this.closest('div').parentElement.remove()" 
                        style="padding:10px 20px; background:#e74c3c; color:white; border:none; border-radius:5px; cursor:pointer;">
                    ✕ Close
                </button>
            </div>
            <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap:20px;">
    `;
    
    Object.keys(this.legendGroups).forEach(groupKey => {
        const group = this.legendGroups[groupKey];
        
        content += `
            <div style="background:#f8f9fa; padding:20px; border-radius:8px; border-left:5px solid ${group.color};">
                <div style="display:flex; align-items:center; margin-bottom:15px;">
                    <img src="/uploads/${group.previewImage}" style="width:60px; height:40px; object-fit:contain; border:1px solid #ddd; border-radius:4px; margin-right:10px; background:white; padding:5px;" />
                    <h3 style="margin:0; color:${group.color};">${group.name}</h3>
                </div>
                <div style="background:#27ae60; color:white; padding:15px; border-radius:6px; margin-bottom:15px; text-align:center;">
                    <div style="font-size:0.9rem; opacity:0.9;">Total Measurement</div>
                    <div style="font-size:1.8rem; font-weight:bold;">${group.total.toFixed(2)} ft</div>
                </div>
                <div style="max-height:300px; overflow-y:auto;">
                    <table style="width:100%; border-collapse:collapse;">
                        <thead>
                            <tr style="background:#e9ecef;">
                                <th style="padding:8px; text-align:left; border-bottom:2px solid #ddd;">Name</th>
                                <th style="padding:8px; text-align:right; border-bottom:2px solid #ddd;">Value</th>
                            </tr>
                        </thead>
                        <tbody>
        `;
        
        group.items.forEach(item => {
            content += `
                <tr style="border-bottom:1px solid #eee;">
                    <td style="padding:8px; font-size:0.85rem;">${item.name}</td>
                    <td style="padding:8px; text-align:right; font-weight:600; color:#27ae60;">${item.realDistance.toFixed(2)} ft</td>
                </tr>
            `;
        });
        
        content += `
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    });
    
    content += '</div></div>';
    modal.innerHTML = content;
    document.body.appendChild(modal);
}
startClickMeasurement() {
    if (!this.isCalibrated) {
        alert('Please calibrate first!');
        return;
    }
    
    // Only ask for name if we don't have one, or if shift key was pressed (optional)
    if (!this.pendingGroupName) {
        const groupName = prompt('Enter Group Name (e.g., "Outer Walls"):');
        if (!groupName) return;
        this.pendingGroupName = groupName;
    }
    
    this.clickDetectionMode = true;
    this.isMeasuring = false;
    this.isCalibrating = false;
    
    // Update tooltip to show how to exit
    this.updateTooltip(`[CONTINUOUS MODE] Clicking adds to group: "${this.pendingGroupName}". Press ESC to stop.`);
    this.canvas.style.cursor = 'crosshair';
    
    // Optional: Visual indicator that we are in a mode
    document.getElementById('clickMeasureBtn').style.background = '#e74c3c';
    document.getElementById('clickMeasureBtn').textContent = '🛑 Stop Measuring (Esc)';
}
async handleCanvasClick(point) {
    if (!this.clickDetectionMode) return;
    
    // Show a temporary "Processing..." cursor
    document.body.style.cursor = 'wait';
    
    await this.measureFromClickPoint(point);
    
    // Restore crosshair cursor
    document.body.style.cursor = 'default';
    this.canvas.style.cursor = 'crosshair';
    
    // We do NOT set clickDetectionMode = false here. 
    // It stays true so you can click the next object immediately.
}

findLegendAtPoint(point) {
    // Check if point is within any detected legend bounds
    for (let legend of this.detectedLegends) {
        const b = legend.bounds;
        if (point.x >= b.x && point.x <= b.x + b.width &&
            point.y >= b.y && point.y <= b.y + b.height) {
            return legend;
        }
    }
    return null;
}
// Inside your ProfessionalImageMeasurementTool class

async measureFromClickPoint(point) {
    // Send a tiny precision click point
    const boxSize = 1; 
    const bounds = {
        x: point.x,
        y: point.y,
        width: boxSize,
        height: boxSize
    };
    
    try {
        const response = await fetch('/measure-clicked-object', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                filename: this.currentFilename,
                clicked_bounds: bounds
            })
        });
        
        const result = await response.json();
        
        if (result.success && result.object) {
            const obj = result.object;
            const groupKey = this.pendingGroupName;
            
            // Length is the main dimension, Width is the thickness
            const lengthVal = obj.precise_height;
            const thicknessVal = obj.precise_width;
            const isVertical = obj.angle === 90;

            // 1. Create Measurement for LENGTH (The main dimension you want)
            const lengthMeas = {
                id: ++this.measurementIdCounter,
                line: {
                    // Draw line along the "outside" edge depending on orientation
                    start: { 
                        x: isVertical ? obj.x + obj.width + 15 : obj.x, 
                        y: isVertical ? obj.y : obj.y - 15 
                    },
                    end: { 
                        x: isVertical ? obj.x + obj.width + 15 : obj.x + obj.width, 
                        y: isVertical ? obj.y + obj.height : obj.y - 15
                    }
                },
                pixelDistance: lengthVal,
                realDistance: this.pixelsToFeet(lengthVal),
                group: groupKey,
                type: 'length',
                autoDetected: true,
                name: `${groupKey} - Length`,
                showArrows: true
            };
            
            // 2. Create Measurement for THICKNESS
            const widthMeas = {
                id: ++this.measurementIdCounter,
                line: {
                     // Draw line along the bottom or right edge
                    start: { 
                        x: isVertical ? obj.x : obj.x + obj.width + 15,
                        y: isVertical ? obj.y + obj.height + 15 : obj.y
                    },
                    end: { 
                        x: isVertical ? obj.x + obj.width : obj.x + obj.width + 15, 
                        y: isVertical ? obj.y + obj.height + 15 : obj.y + obj.height
                    }
                },
                pixelDistance: thicknessVal,
                realDistance: this.pixelsToFeet(thicknessVal),
                group: groupKey,
                type: 'width',
                autoDetected: true,
                name: `${groupKey} - Thickness`,
                showArrows: true
            };

            this.measurements.push(lengthMeas, widthMeas);
            this.saveToHistory();
            this.updateMeasurementsList();
            this.renderTotalControls();
            this.redrawCanvas();
            
            // --- REMOVED ORANGE BORDER highlight as requested ---
            /*
            this.ctx.save();
            this.ctx.strokeStyle = '#e74c3c';
            this.ctx.lineWidth = 3;
            this.ctx.strokeRect(obj.x, obj.y, obj.width, obj.height);
            this.ctx.restore();
            */
            
            this.updateTooltip(`Measured: ${lengthMeas.realDistance.toFixed(2)}'`);
        } else {
            // More informative error message
            alert(result.error || 'Could not find clear wall boundaries at click location.');
        }
    } catch (error) {
        console.error(error);
        alert('Server error.');
    }
}
processClickedLegends(legends, color, pattern) {
    const groupKey = `${color}_${pattern}_${this.pendingGroupName}`;
    const displayName = `${this.pendingGroupName} (${color} ${pattern})`;
    
    if (!this.legendGroups[groupKey]) {
        this.legendGroups[groupKey] = {
            name: displayName,
            color: color,
            pattern: pattern,
            previewImage: null,
            items: [],
            total: 0
        };
    }
    
    legends.forEach((legend, index) => {
        // Width measurement with proper arrow visualization
        const widthMeasurement = {
            id: ++this.measurementIdCounter,
            line: {
                start: { x: legend.edge_points.left[0], y: legend.edge_points.left[1] },
                end: { x: legend.edge_points.right[0], y: legend.edge_points.right[1] }
            },
            pixelDistance: legend.dimensions.width,
            realDistance: this.pixelsToFeet(legend.dimensions.width),
            group: groupKey,
            type: 'width',
            autoDetected: true,
            name: `${displayName} Width #${index + 1}`,
            showArrows: true  // Flag for arrow display
        };
        
        // Height measurement with proper arrow visualization
        const heightMeasurement = {
            id: ++this.measurementIdCounter,
            line: {
                start: { x: legend.edge_points.top[0], y: legend.edge_points.top[1] },
                end: { x: legend.edge_points.bottom[0], y: legend.edge_points.bottom[1] }
            },
            pixelDistance: legend.dimensions.height,
            realDistance: this.pixelsToFeet(legend.dimensions.height),
            group: groupKey,
            type: 'height',
            autoDetected: true,
            name: `${displayName} Height #${index + 1}`,
            showArrows: true
        };
        
        this.measurements.push(widthMeasurement);
        this.measurements.push(heightMeasurement);
        
        this.legendGroups[groupKey].items.push(widthMeasurement, heightMeasurement);
        this.legendGroups[groupKey].total += widthMeasurement.realDistance + heightMeasurement.realDistance;
    });
    
    this.saveToHistory();
    this.updateMeasurementsList();
    this.updateLegendGroupsDisplay();
    this.redrawCanvas();
}
    // Measurement management
    addMeasurement(start, end) {
        const distance = this.calculateDistance(start, end);
        const realDistance = this.pixelsToFeet(distance);
        
        const measurement = {
            id: ++this.measurementIdCounter,
            line: { start, end },
            pixelDistance: distance,
            realDistance: realDistance,
            group: this.currentGroupName,
            autoDetected: false
        };
        
        this.measurements.push(measurement);
        this.saveToHistory();
        this.updateMeasurementsList();
        this.redrawCanvas();
        this.updateTooltip(`Added measurement: ${realDistance.toFixed(2)} feet to group: ${this.currentGroupName}`);
    }
    
    deleteMeasurement(measurementId) {
        const index = this.measurements.findIndex(m => m.id === measurementId);
        if (index !== -1) {
            this.measurements.splice(index, 1);
            this.saveToHistory();
            this.updateMeasurementsList();
            this.redrawCanvas();
            this.updateTooltip('Measurement deleted');
            if (this.selectedMeasurement === measurementId) {
                this.selectedMeasurement = null;
            }
        }
    }
    
    selectMeasurement(measurementId) {
        this.selectedMeasurement = measurementId;
        this.updateMeasurementsList();
        this.redrawCanvas();
    }
    
    focusOnMeasurement(measurementId) {
        const measurement = this.measurements.find(m => m.id === measurementId);
        if (measurement) {
            this.selectedMeasurement = measurementId;
            this.redrawCanvas();
            this.updateTooltip(`Focused on measurement: ${measurement.realDistance.toFixed(2)} ft`);
        }
    }
    
    clearAllMeasurements() {
        if (this.measurements.length === 0) return;
        
        if (confirm('Are you sure you want to delete all measurements?')) {
            this.measurements = [];
            this.selectedMeasurement = null;
            this.detectedLegends = [];
            this.legendGroups = {};
            this.saveToHistory();
            this.updateMeasurementsList();
            this.updateLegendGroupsDisplay();
            this.redrawCanvas();
            this.updateTooltip('All measurements cleared');
        }
    }
    
    // History management (Undo/Redo)
    saveToHistory() {
        // Remove any future states if we're not at the end
        this.measurementHistory = this.measurementHistory.slice(0, this.historyIndex + 1);
        
        // Save current state
        this.measurementHistory.push(JSON.parse(JSON.stringify(this.measurements)));
        this.historyIndex++;
        
        // Limit history to 50 states
        if (this.measurementHistory.length > 50) {
            this.measurementHistory.shift();
            this.historyIndex--;
        }
        
        this.updateUndoRedoButtons();
    }
    
    undo() {
        if (this.historyIndex > 0) {
            this.historyIndex--;
            this.measurements = JSON.parse(JSON.stringify(this.measurementHistory[this.historyIndex]));
            this.updateMeasurementsList();
            this.redrawCanvas();
            this.updateTooltip('Undo successful');
            this.updateUndoRedoButtons();
        }
    }
    
    redo() {
        if (this.historyIndex < this.measurementHistory.length - 1) {
            this.historyIndex++;
            this.measurements = JSON.parse(JSON.stringify(this.measurementHistory[this.historyIndex]));
            this.updateMeasurementsList();
            this.redrawCanvas();
            this.updateTooltip('Redo successful');
            this.updateUndoRedoButtons();
        }
    }
    
    updateUndoRedoButtons() {
        const undoBtn = document.getElementById('undoBtn');
        const redoBtn = document.getElementById('redoBtn');
        
        if (undoBtn) undoBtn.disabled = this.historyIndex <= 0;
        if (redoBtn) redoBtn.disabled = this.historyIndex >= this.measurementHistory.length - 1;
    }
    
    updateMeasurementsList() {
        const container = document.getElementById('measurementsList');
        if (this.measurements.length === 0) {
            container.innerHTML = '<p class="no-measurements">No measurements yet</p>';
            const totalContainer = document.getElementById('totalContainer');
            if (totalContainer) totalContainer.innerHTML = '';
            return;
        }
        container.innerHTML = '';
        this.measurements.forEach((measurement, index) => {
            const item = this.createMeasurementItem(measurement, index);
            container.appendChild(item);
        });
        this.renderTotalControls();
    }
    
    createMeasurementItem(measurement, index) {
        const template = document.getElementById('measurementTemplate');
        const item = template.content.cloneNode(true);
        const measurementDiv = item.querySelector('.measurement-item');
        const label = item.querySelector('.measurement-label');
        const value = item.querySelector('.measurement-value');
        const editBtn = item.querySelector('.edit-btn');
        const deleteBtn = item.querySelector('.delete-btn');
        const focusBtn = item.querySelector('.focus-btn');
        
        // Show group name
        const groupSpan = document.createElement('span');
        groupSpan.className = 'measurement-group';
        groupSpan.style.cssText = 'display:block; font-size:0.85rem; color:#7f8c8d; margin-bottom:5px;';
        groupSpan.textContent = `Group: ${measurement.group}`;
        measurementDiv.prepend(groupSpan);
        
        // Sr. No.
        const srNo = document.createElement('span');
        srNo.className = 'measurement-srno';
        srNo.style.cssText = 'display:block; font-size:0.8rem; color:#95a5a6; margin-bottom:3px;';
        srNo.textContent = `Sr. No. ${index + 1}`;
        measurementDiv.prepend(srNo);
        
        // Auto-detected badge
        if (measurement.autoDetected) {
            const badge = document.createElement('span');
            badge.style.cssText = 'display:inline-block; padding:2px 8px; background:#3498db; color:white; font-size:0.7rem; border-radius:10px; margin-left:5px;';
            badge.textContent = 'AUTO';
            groupSpan.appendChild(badge);
        }
        
        // Allow renaming
        label.textContent = measurement.name || `Measurement ${index + 1}`;
        value.textContent = `${measurement.realDistance.toFixed(2)} ft`;
        
        editBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const newName = prompt('Rename measurement:', label.textContent);
            if (newName) {
                measurement.name = newName;
                label.textContent = newName;
            }
        });
        
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.deleteMeasurement(measurement.id);
        });
        
        focusBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.focusOnMeasurement(measurement.id);
        });
        
        measurementDiv.addEventListener('click', () => this.selectMeasurement(measurement.id));
        
        return item;
    }
    
    renderTotalControls() {
        let totalContainer = document.getElementById('totalContainer');
        if (!totalContainer) {
            totalContainer = document.createElement('div');
            totalContainer.id = 'totalContainer';
            document.getElementById('measurementsList').after(totalContainer);
        }
        totalContainer.innerHTML = `
            <button id="newGroupBtn" class="btn-primary" style="margin-bottom:10px;">New Group</button>
            <span id="currentGroupNameDisplay" style="margin-left:10px;font-weight:600;"></span>
            <input id="groupTotalInput" type="text" placeholder="Enter group name for total" style="margin-top:10px;width:60%;padding:6px;">
            <button id="calcTotalBtn" class="btn-success" style="margin-top:10px;">Calculate Total</button>
            <div id="totalResult"></div>
        `;
        document.getElementById('newGroupBtn').onclick = () => this.promptGroupName();
        document.getElementById('calcTotalBtn').onclick = () => this.calculateTotalByGroup();
        document.getElementById('currentGroupNameDisplay').textContent = this.currentGroupName ? `Current Group: ${this.currentGroupName}` : '';
    }
    
    calculateTotalByGroup() {
        const groupName = document.getElementById('groupTotalInput').value.trim();
        if (!groupName) {
            alert('Enter a group name to calculate total.');
            return;
        }
        const groupMeasurements = this.measurements.filter(m => m.group === groupName);
        if (groupMeasurements.length === 0) {
            alert('No measurements found for this group name.');
            return;
        }
        let total = 0;
        let names = [];
        groupMeasurements.forEach(m => {
            total += m.realDistance;
            names.push(m.name || `Measurement ${m.id}`);
        });
        const totalResult = document.getElementById('totalResult');
        totalResult.innerHTML = `
            <div class="measurement-total">
                <span><b>Total for group '${groupName}' (${names.join(' + ')}):</b> <span style="color:#27ae60;font-size:1.2em;">${total.toFixed(2)} ft</span></span>
                <button id="deleteTotalBtn" class="btn-danger" style="margin-left:10px;">Delete Total</button>
            </div>
        `;
        document.getElementById('deleteTotalBtn').onclick = () => {
            totalResult.innerHTML = '';
        };
    }
    
    promptGroupName() {
        let name = prompt('Enter group name for measurements:', this.currentGroupName || '');
        if (name) {
            this.currentGroupName = name;
            document.getElementById('currentGroupNameDisplay').textContent = `Current Group: ${name}`;
        }
    }
    
    // Calibration functions
    startCalibration() {
        this.isCalibrating = true;
        this.isMeasuring = false;
        document.getElementById('setCalibrateBtn').textContent = 'Drawing Reference Line...';
        document.getElementById('measureBtn').classList.remove('active');
        this.updateTooltip('Click and drag to set reference object');
    }
    
    async confirmCalibration() {
        if (!this.calibrationPoints) {
            alert('Please draw a calibration line first');
            return;
        }
        
        const referenceLength = parseFloat(document.getElementById('referenceLength').value);
        const pixelDistance = this.calculateDistance(this.calibrationPoints.start, this.calibrationPoints.end);
        
        try {
            const response = await fetch('/calibrate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    pixel_distance: pixelDistance,
                    real_distance: referenceLength
                })
            });
            
            const result = await response.json();
            
            if (result.success) {
                this.isCalibrated = true;
                this.isCalibrating = false;
                this.pixelsPerUnit = result.pixels_per_unit;
                document.getElementById('confirmCalibrationBtn').style.display = 'none';
                document.getElementById('setCalibrateBtn').textContent = 'Recalibrate';
                const status = document.getElementById('calibrationStatus');
                status.textContent = 'Calibrated ✓';
                status.className = 'calibration-status calibrated';
                this.updateTooltip('Calibration complete! Ready to measure.');
                this.redrawCanvas();
            }
        } catch (error) {
            alert('Calibration failed: ' + error.message);
        }
    }
    
    startMeasuring() {
    if (!this.isCalibrated) {
        alert('Please calibrate the scale first');
        return;
    }
    
    // Show click measurement option
    const clickBtn = document.getElementById('clickMeasureBtn');
    if (clickBtn) clickBtn.style.display = 'block';
    
    if (!this.currentGroupName) {
        this.promptGroupName();
        if (!this.currentGroupName) return;
    }
    this.isMeasuring = true;
    this.isCalibrating = false;
    document.getElementById('measureBtn').classList.add('active');
    this.updateTooltip(`Click and drag to measure OR use "Click Legend to Measure" for automatic detection`);
}
    
    // Utility functions
    calculateDistance(point1, point2) {
        return Math.sqrt(Math.pow(point2.x - point1.x, 2) + Math.pow(point2.y - point1.y, 2));
    }
    
    pixelsToFeet(pixels) {
        return pixels / this.pixelsPerUnit;
    }
    
    updateTooltip(text) {
        document.getElementById('tooltipText').textContent = text;
    }
    
    cancelCurrentOperation() {
    this.isCalibrating = false;
    this.isMeasuring = false;
    this.isDrawing = false;
    this.startPoint = null;
    
    // Reset Continuous Click Mode
    if (this.clickDetectionMode) {
        this.clickDetectionMode = false;
        this.pendingGroupName = ''; // Clear the name so you are prompted next time
        this.canvas.style.cursor = 'default';
        
        // Reset button style
        const btn = document.getElementById('clickMeasureBtn');
        if (btn) {
            btn.style.background = ''; // Reset to default CSS
            btn.textContent = '🎯 Click Legend to Measure';
        }
        
        this.updateTooltip('Measurement mode stopped.');
        return; // Exit early
    }
    
    document.getElementById('setCalibrateBtn').textContent = this.isCalibrated ? 'Recalibrate' : 'Set Reference';
    document.getElementById('measureBtn').classList.remove('active');
    
    this.updateTooltip('Operation cancelled');
}
    
    // Touch event handlers for mobile support
    handleTouchStart(e) {
        e.preventDefault();
        const touch = e.touches[0];
        this.handleMouseDown({ 
            clientX: touch.clientX, 
            clientY: touch.clientY,
            button: 0 
        });
    }
    
    handleTouchMove(e) {
        e.preventDefault();
        const touch = e.touches[0];
        this.handleMouseMove({ 
            clientX: touch.clientX, 
            clientY: touch.clientY 
        });
    }
    
    handleTouchEnd(e) {
        e.preventDefault();
        const touch = e.changedTouches[0];
        this.handleMouseUp({ 
            clientX: touch.clientX, 
            clientY: touch.clientY 
        });
    }
}

// Global instance for access from inline handlers
let tool;

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
    tool = new ProfessionalImageMeasurementTool();
});
