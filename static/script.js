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
            this.updateTooltip('Image loaded successfully');
            
            // Force redraw
            setTimeout(() => {
                this.drawImage();
            }, 100);
        };
        img.onerror = () => {
            console.error('Failed to load image:', filename);
            alert('Failed to load image. Please try again.');
        };
        img.src = `/uploads/${filename}?t=${Date.now()}`;
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
    
    handleMouseDown(e) {
        if (e.button !== 0) return; // Only left mouse button
        
        const point = this.getCanvasPoint(e);
        
        if (this.isCalibrating || this.isMeasuring) {
            this.startPoint = point;
            this.isDrawing = true;
        } else if (e.altKey || e.button === 1) { // Enable panning with Alt key or middle mouse button
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
        
        if (this.isDrawing && this.startPoint) {
            this.redrawCanvas();
            this.drawMeasurementLine(this.startPoint, point, this.isCalibrating ? '#e74c3c' : '#27ae60');
            
            const distance = this.calculateDistance(this.startPoint, point);
            let displayText = `${distance.toFixed(1)} pixels`;
            
            if (this.isCalibrated && !this.isCalibrating) {
                const realDistance = this.pixelsToFeet(distance);
                displayText = `${realDistance.toFixed(2)} feet`;
            }
            
            this.updateTooltip(displayText);
        }
    }
    
    handleMouseUp(e) {
        if (this.isPanning) {
            this.isPanning = false;
            document.querySelector('.canvas-container').classList.remove('grabbing');
        }
        
        if (!this.isDrawing || !this.startPoint) return;
        
        const point = this.getCanvasPoint(e);
        const distance = this.calculateDistance(this.startPoint, point);
        
        if (distance < 10) { // Minimum distance threshold
            this.isDrawing = false;
            return;
        }
        
        if (this.isCalibrating) {
            this.calibrationPoints = { start: this.startPoint, end: point };
            document.getElementById('confirmCalibrationBtn').style.display = 'inline-block';
            this.updateTooltip('Calibration line set. Click Confirm Calibration.');
        } else if (this.isMeasuring) {
            this.addMeasurement(this.startPoint, point);
        }
        
        this.isDrawing = false;
        this.startPoint = null;
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
        
        // Redraw measurements
        this.measurements.forEach((measurement, index) => {
            const color = measurement.id === this.selectedMeasurement ? '#f39c12' : '#27ae60';
            this.drawMeasurementLine(measurement.line.start, measurement.line.end, color);
            this.drawMeasurementLabel(measurement.line, `${measurement.realDistance.toFixed(2)} ft`);
        });
    }
    
    drawMeasurementLine(start, end, color = '#27ae60', width = 4) {
        // Main line
        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = width;
        this.ctx.lineCap = 'round';
        this.ctx.setLineDash([]);
        
        this.ctx.beginPath();
        this.ctx.moveTo(start.x, start.y);
        this.ctx.lineTo(end.x, end.y);
        this.ctx.stroke();
        
        // Enhanced endpoints with cross-hairs
        this.drawMeasurementPoint(start, color);
        this.drawMeasurementPoint(end, color);
        
        // Draw extension lines for better visibility
        this.drawExtensionLines(start, end, color);
    }
    
    drawMeasurementPoint(point, color) {
        const size = 8;
        
        // Outer circle
        this.ctx.fillStyle = color;
        this.ctx.beginPath();
        this.ctx.arc(point.x, point.y, size, 0, 2 * Math.PI);
        this.ctx.fill();
        
        // Inner circle
        this.ctx.fillStyle = 'white';
        this.ctx.beginPath();
        this.ctx.arc(point.x, point.y, size - 3, 0, 2 * Math.PI);
        this.ctx.fill();
        
        // Cross-hair
        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = 2;
        this.ctx.beginPath();
        this.ctx.moveTo(point.x - size + 2, point.y);
        this.ctx.lineTo(point.x + size - 2, point.y);
        this.ctx.moveTo(point.x, point.y - size + 2);
        this.ctx.lineTo(point.x, point.y + size - 2);
        this.ctx.stroke();
    }
    
    drawExtensionLines(start, end, color) {
        const extLength = 20;
        const angle = Math.atan2(end.y - start.y, end.x - start.x);
        const perpAngle = angle + Math.PI / 2;
        
        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = 1;
        this.ctx.setLineDash([5, 5]);
        
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
    
    drawMeasurementLabel(line, text) {
        const midX = (line.start.x + line.end.x) / 2;
        const midY = (line.start.y + line.end.y) / 2;

        // Improved background for visibility
        this.ctx.save();
        this.ctx.globalAlpha = 0.98;
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
        const textFont = 'bold 22px Arial';
        this.ctx.font = textFont;
        const textWidth = this.ctx.measureText(text).width + 24;
        this.ctx.fillRect(midX - textWidth/2, midY - 24, textWidth, 36);
        this.ctx.globalAlpha = 1.0;

        // White border for contrast
        this.ctx.strokeStyle = 'white';
        this.ctx.lineWidth = 2;
        this.ctx.strokeRect(midX - textWidth/2, midY - 24, textWidth, 36);

        // Draw measurement value only, bold yellow with strong shadow
        this.ctx.font = textFont;
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        this.ctx.shadowColor = 'black';
        this.ctx.shadowBlur = 8;
        this.ctx.fillStyle = '#ffe600'; // Bright yellow for measurement value
        this.ctx.fillText(text, midX, midY);
        this.ctx.shadowBlur = 0;
        this.ctx.restore();
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
            group: this.currentGroupName
        };
        
        this.measurements.push(measurement);
        this.updateMeasurementsList();
        this.redrawCanvas();
        this.updateTooltip(`Added measurement: ${realDistance.toFixed(2)} feet to group: ${this.currentGroupName}`);
    }
    
    updateMeasurementsList() {
        const container = document.getElementById('measurementsList');
        if (this.measurements.length === 0) {
            container.innerHTML = '<p class="no-measurements">No measurements yet</p>';
            document.getElementById('totalContainer').innerHTML = '';
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
        groupSpan.textContent = `Group: ${measurement.group}`;
        measurementDiv.prepend(groupSpan);
        // Sr. No.
        const srNo = document.createElement('span');
        srNo.className = 'measurement-srno';
        srNo.textContent = `Sr. No. ${index + 1}`;
        measurementDiv.prepend(srNo);
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
        if (!this.currentGroupName) {
            this.promptGroupName();
            if (!this.currentGroupName) return;
        }
        this.isMeasuring = true;
        this.isCalibrating = false;
        document.getElementById('measureBtn').classList.add('active');
        this.updateTooltip(`Click and drag to measure objects for group: ${this.currentGroupName}`);
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

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
    new ProfessionalImageMeasurementTool();
});
