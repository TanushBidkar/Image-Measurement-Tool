/* =================================================================
 * IMPORTS
 * ================================================================= */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const XLSX = require('xlsx');
const { initializeApp } = require('firebase/app');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || 'YOUR_GEMINI_API_KEY_HERE');
const ExcelJS = require('exceljs');


process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const {
    getFirestore, doc, updateDoc, arrayUnion,
    collection, query, where, getDocs, addDoc, getDoc,
    increment, setDoc, deleteDoc
} = require('firebase/firestore');

const { getStorage, ref, uploadBytes, getDownloadURL, listAll } = require('firebase/storage');

/* =================================================================
 * CONFIGURATION & INITIALIZATION
 * ================================================================= */
const app = express();
const JWT_SECRET = process.env.JWT_SECRET || 'a45f764d81cca3665aecedffd4330c12a6d011ad9e2443be7e0268de841510b987e3b0b15244fe4f222998ff00fe9f936ff0802a222994a224830d4f2ab604f7';
const PORT = process.env.PORT || 3002;
const TELEGRAM_TOKEN = '7747304751:AAFXLMxs0MYe7nYTqhYvZXFIo2uogEYdriw';
const GROUP_CHAT_ID = '-4902362135';

const firebaseConfig = {
    apiKey: "AIzaSyDBbxpBfHVT8FXCSH-byP1C1qDXClVY3pY",
    authDomain: "ai-based-review-tools.firebaseapp.com",
    projectId: "ai-based-review-tools",
    storageBucket: "ai-based-review-tools.firebasestorage.app",
    messagingSenderId: "695145683771",
    appId: "1:695145683771:web:432fe1f5792c46a177751e"
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);
const storage = getStorage(firebaseApp);
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

console.log('Firebase Connected. Telegram bot polling...');

async function sendApprovalEmail(name, email, location, approveLink) {
    try {
        const response = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer re_hjKz8hkK_S4UQCUEyR7t5Bi1Zwr1AWzbW`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                from: 'RAA CushWake <onboarding@resend.dev>',
                to: 'raa.cushwake@gmail.com',
                subject: `New User Approval Request - ${name}`,
                html: `
                    <h2>New User Registration</h2>
                    <p><strong>Name:</strong> ${name}</p>
                    <p><strong>Email:</strong> ${email}</p>
                    <p><strong>Location:</strong> ${location || 'Not provided'}</p>
                    <a href="${approveLink}" style="background:#4CAF50;color:white;padding:12px 24px;text-decoration:none;border-radius:5px;display:inline-block;margin-top:10px;">✅ Approve User</a>
                `
            })
        });
        if (!response.ok) {
            console.log('Approval email could not be sent:', await response.text());
        } else {
            console.log('Approval email sent successfully');
        }
    } catch (err) {
        console.log('Approval email failed:', err.message);
    }
}

/* =================================================================
 * HELPER FUNCTION TO UPLOAD IMAGE BUFFER TO FIREBASE
 * ================================================================= */
async function uploadImageToFirebase(imageBuffer, fileName, chatSessionId) {
    try {
        const timestamp = Date.now();
        const storagePath = `chat_uploads/${chatSessionId}/${timestamp}_${fileName}`;
        const storageRef = ref(storage, storagePath);
        
        const metadata = { contentType: 'image/png' };
        
        const snapshot = await uploadBytes(storageRef, imageBuffer, metadata);
        const downloadURL = await getDownloadURL(snapshot.ref);
        
        console.log(`Firebase upload successful: ${downloadURL}`);
        return downloadURL;
    } catch (error) {
        console.error('Firebase upload error:', error);
        throw new Error(`Firebase upload failed: ${error.message}`);
    }
}

/* =================================================================
 * FIREBASE STORAGE HELPER FUNCTION - FIXED
 * ================================================================= */
async function listFilesFromStorage(banks, locations) {
    console.log('[DEBUG] Starting listFilesFromStorage function...');
    console.log('[DEBUG] Banks:', banks);
    console.log('[DEBUG] Locations:', locations);
    
    try {
        let allSheets = [];
        
        for (const bank of banks) {
            for (const location of locations) {
                try {
                    // Construct the correct path: measurement/BANK/LOCATION/
                    const folderPath = `measurement/${bank}/${location}`;
                    const folderRef = ref(storage, folderPath);
                    
                    console.log(`[DEBUG] Listing files in path: "${folderPath}"`);
                    
                    const listResult = await listAll(folderRef);
                    
                    console.log(`[DEBUG] Found ${listResult.items.length} files in "${folderPath}"`);
                    
                    for (const item of listResult.items) {
                        try {
                            const downloadURL = await getDownloadURL(item);
                            
                            allSheets.push({
                                fileName: item.name,
                                bank: bank,
                                location: location,
                                fullPath: item.fullPath,
                                downloadURL: downloadURL,
                            });
                            
                            console.log(`[DEBUG] Added file: ${item.name}`);
                        } catch (fileError) {
                            console.error(`[DEBUG] Error processing file ${item.name}:`, fileError.message);
                        }
                    }
                } catch (folderError) {
                    console.error(`[DEBUG] Error accessing folder ${bank}/${location}:`, folderError.message);
                }
            }
        }
        
        console.log(`[DEBUG] Total files collected: ${allSheets.length}`);
        return allSheets;
        
    } catch (error) {
        console.error('[DEBUG] Critical error in listFilesFromStorage:', error);
        throw new Error('Failed to fetch sheets from Firebase Storage');
    }
}

/* =================================================================
 * CHAT FLOW DEFINITION
 * ================================================================= */
const chatFlow = {
    root: {
        message: "Hello! How can I help you today?",
        options: [
            { type: 'navigate', text: "Summary Checks", value: "Summary checks", icon: "fas fa-clipboard-list", target: "summaryMenu" },
            { type: 'action', action: 'create_session', text: "Calculations & Formulas", value: "Calculations & Formulas", icon: "fas fa-calculator" },
            { type: 'navigate', text: "Remark Checks", value: "Remark check", icon: "fas fa-comment-dots", target: "remarkMenu" },
            { type: 'action', action: 'create_session', text: "Variance Checks", value: "Variance check", icon: "fas fa-chart-bar" },
            { type: 'action', action: 'create_session', text: "Manual Verification", value: "Manual Verification", icon: "fas fa-user-check" },
            { type: 'navigate', text: "Linking Checks", value: "Linking checks", icon: "fas fa-link", target: "linkingMenu" },
            { type: 'action', action: 'create_session', text: "Data Extraction", value: "Extracted Data sheet", icon: "fas fa-file-excel" },
            { type: 'action', action: 'create_session', text: "Macros Insertion", value: "Macros insertion", icon: "fas fa-code" },
            { type: 'action', action: 'create_session', text: "Report Review", value: "Report review", icon: "fas fa-file-signature" },
            { type: 'action', action: 'create_session', text: "Threshold Check", value: "Threshold Check", icon: "fas fa-ruler-combined" },
            { type: 'action', action: 'create_session', text: "Other", value: "Other", icon: "fas fa-question-circle" }
        ]
    },
    summaryMenu: {
        message: "You've selected Summary Checks. Please specify the issue:",
        options: [
            { type: 'navigate', text: "Error in extracted data sheet", value: "Summary Error in extracted data sheet", icon: "fas fa-file-excel", target: "summarySolutions" },
            { type: 'navigate', text: "Error on Website (tool)", value: "Summary Error on Website (tool)", icon: "fas fa-desktop", target: "summaryWebsiteSolutions" },
        ]
    },
    summarySolutions: {
        message: "For issues with the extracted data sheet, please check these common solutions or connect with an agent.",
        options: [
            { type: 'info', text: "Step 1: Sheet Placement", icon: "fas fa-layer-group", payload: "📑 **Step 1: Summary Sheet Placement**\n\n✅ Ensure that the required Summary sheet (CWI Summary / General Summary) is placed at the very beginning of the Excel file.\n\n❌ Remove any unnecessary summary sheets to avoid confusion." },
            { type: 'info', text: "Step 2: Rename Headers", icon: "fas fa-heading", payload: "🏷️ **Step 2: Rename Headers in Standard Format**\n\nUse the following format for consistency:\n1️⃣ Sr. No\n2️⃣ Particulars\n3️⃣ As per WO\n4️⃣ As per Pre-Audit\n5️⃣ As per Post-Audit\n6️⃣ As per CWI\n7️⃣ Savings\n8️⃣ Excess\n9️⃣ Total" },
            { type: 'action', action: 'create_session', text: "Connect to an Agent", value: "Summary Error (Extracted Data)", icon: "fas fa-headset" }
        ]
    },
    summaryWebsiteSolutions: {
        message: "For summary errors on the website tool, please review these common issues or connect with an agent.",
        options: [
            { type: 'info', text: "A) Summary Error on Website", icon: "fas fa-exclamation-triangle", payload: "🔹 **A) Summary Error on Website**\n\nIf you see a message like \"Couldn't extract Summary Sheet\":\n\n👉 Follow the two steps listed in \"Summary Error in Extracted Data Sheet\"." },
            { type: 'info', text: "B) Mismatch in Summary Check", icon: "fas fa-not-equal", payload: "🔹 **B) Mismatch in Summary Check**\n\nSometimes the tool shows a mismatch even though values look correct.\n\n💡 **Check Sr. No / U Code mapping carefully:**\n*Example:*\nBOQ Sheet → `VI. Electrification`\nSummary Sheet → `VII. Electrification`\n\n❌ Numbers don't match → Tool shows mismatch.\n✅ Fix by aligning Sr. No / U Code correctly." },
            { type: 'info', text: "C) Double Total Issue", icon: "fas fa-clone", payload: "🔹 **C) Double Total Issue**\n\nSometimes the tool adds totals twice.\n*Example:* Civil Works total = 6,000, but the tool shows 12,000.\n\n✅ **Fix:** Open the Extracted Data Sheet → Find and remove the extra \"Total\" row from the data." },
            { type: 'action', action: 'create_session', text: "D) Connect with an agent", value: "Summary Error (Website Tool)", icon: "fas fa-headset" }
        ]
    },
    linkingMenu: {
        message: "Please choose an option below",
        options: [
            { type: 'navigate', text: "Renaming Sheets for Linking Checks", value: "Renaming Sheets", icon: "fas fa-pencil-alt", target: "renamingInfo" },
            { type: 'navigate', text: "Resolve Linking Checks Issues", value: "Resolve Issues", icon: "fas fa-cogs", target: "resolveMenu" },
            { type: 'action', action: 'create_session', text: "Connect to an Agent", value: "Linking Checks Issue", icon: "fas fa-headset" }
        ]
    },
    renamingInfo: {
        message: "Before running checks, follow these steps carefully:",
        options: [
            { 
                type: 'info', 
                text: "Sheet Naming & Header Rules", 
                icon: "fas fa-info-circle", 
                payload: "Sheet Names: Rename your sheets as: BOQ, BOQ1, BOQ2... Measurement sheet, Measurement sheet1, Measurement sheet2...\n\nBOQ Sheet Headers: U.Code, Sr. No, As per Post Audit, As per CWI\n\nMeasurement Sheet Headers: U.Code, Sr. No, Particulars (Every measurement sheet must include these headers.)\n\nKey for Linking: The tool uses either the U.Code or the Sr. No to match items between your BOQ and Measurement sheets."
            }
        ]
    },
    resolveMenu: {
        message: "Choose the type of linking check you want to run",
        options: [
            { type: 'navigate', text: "Sr. No / U.code is Correct", value: "Sr. No Correct", icon: "fas fa-check-circle", target: "srNoCorrectInfo" },
            { type: 'navigate', text: "Linking Based on Particulars", value: "Link by Particulars", icon: "fas fa-align-left", target: "particularsInfo" }
        ]
    },
    srNoCorrectInfo: {
        message: "Option A: Sr. No / U.Code is Correct",
        options: [
            { 
                type: 'info', 
                text: "Logic for Correct Sr. No / U.Code", 
                icon: "fas fa-project-diagram", 
                payload: "If Sr. No / U.Code is present in both BOQ and Measurement sheets, run macro: Sheet linking if U.code / Sr. No is present\n\nIf Sr. No / U.Code is missing in either sheet, run macro: Macro_2_Update_U.Code" 
            }
        ]
    },
    particularsInfo: {
        message: "Option B: Linking Based on Particulars",
        options: [
            { 
                type: 'info', 
                text: "Logic for Linking by Particulars", 
                icon: "fas fa-tasks", 
                payload: "If Sr. No / U.Code is absent in both sheets, run macros: Linking based on Particulars, MACRO_2_SYNC_BY_PARTIAL_PARTICULARS (Run the second macro multiple times until you see: No new match found, sync done)\n\nFinal Step: Run macro: Macro_3_Cross_Check_and_Highlight"
            }
        ]
    },
    remarkMenu: {
        message: "Please choose a scenario for the Remark Checks:",
        options: [
            { type: 'navigate', text: "Work Executed but Not in WO", value: "Not in WO", icon: "fas fa-search-plus", target: "notInWoInfo" },
            { type: 'navigate', text: "Work Executed More than WO Qty", value: "Exceeds WO", icon: "fas fa-chart-line", target: "exceedsWoInfo" },
            { type: 'action', action: 'create_session', text: "Connect to an Agent", value: "Remark Checks Issue", icon: "fas fa-headset" }
        ]
    },
    notInWoInfo: {
        message: "Remarks for Work Executed but Not in the Work Order Qty.",
        options: [
            {
                type: 'info',
                text: 'Follow these steps',
                icon: 'fas fa-list-ol',
                payload: "Steps to follow:\n1. Go to Variation in Quantity: WO vs. Contractor (Post-Audit)\n2. Apply a Number Filter → Greater than 0 (This will show both Exceeding and Not in WO entries)\n3. Go to As per WO/PO (Qty) and select Blanks + Zero → This gives you items not present in the Work Order.\n4. In the Remarks column, write: Work executed but not in WO. PM approval required."
            }
        ]
    },
    exceedsWoInfo: {
        message: "Remarks for Work Executed More Than the Work Order Quantity",
        options: [
            {
                type: 'info',
                text: 'Follow these steps',
                icon: 'fas fa-list-ol',
                payload: "Steps to follow:\n1. Go to Variation in Quantity: WO vs. Contractor (Post-Audit)\n2. Apply a Number Filter → Greater than 0 (This will show both Exceeding and Not in WO entries)\n3. Go to As per WO/PO (Qty) and Remove Blanks → This gives you items where executed quantity > Work Order quantity."
            }
        ]
    }
};

/* =================================================================
 * MIDDLEWARE & AUTH
 * ================================================================= */
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname)));

function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        console.log('[AUTH DEBUG] No token found - returning 401');
        return res.status(401).json({ 
            error: 'No token provided',
            forceLogout: true 
        });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            console.log('[AUTH DEBUG] JWT verification failed:', err.message);
            
            // Check if token is expired
            if (err.name === 'TokenExpiredError') {
                return res.status(401).json({ 
                    error: 'Token expired. Please login again.',
                    forceLogout: true,
                    expired: true
                });
            }
            
            return res.status(403).json({ 
                error: 'Invalid token',
                forceLogout: true 
            });
        }
        
        console.log('[AUTH DEBUG] Token valid for user:', user.email);
        req.user = user;
        next();
    });
}

function authenticateAdmin(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    // ✅ DEBUGGING ADDED
    console.log('[AUTH DEBUG] Authorization header:', authHeader ? 'Present' : 'Missing');
    console.log('[AUTH DEBUG] Token extracted:', token ? 'Yes' : 'No');
    
    if (!token) {
        console.log('[AUTH DEBUG] No token found - returning 401');
        return res.sendStatus(401);
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            console.log('[AUTH DEBUG] JWT verification failed:', err.message);
            return res.status(403).json({ error: 'Forbidden: Invalid token' });
        }
        
        console.log('[AUTH DEBUG] User role:', user.role);
        
        if (user.role !== 'admin') {
            console.log('[AUTH DEBUG] User is not admin - returning 403');
            return res.status(403).json({ error: 'Forbidden: Admins only' });
        }
        
        console.log('[AUTH DEBUG] Admin authentication successful');
        req.user = user;
        next();
    });
}

// ✅ NEW: Check if password was changed after token was issued
async function verifyPasswordNotChanged(req, res, next) {
    try {
        const tokenPasswordChangedAt = req.user.passwordChangedAt;
        
        if (!tokenPasswordChangedAt) {
            return res.status(401).json({ 
                error: 'Session expired. Please login again.',
                forceLogout: true 
            });
        }

        if (req.user.role === 'admin') {
            const adminRef = doc(db, 'adminConfig', 'credentials');
            const adminDoc = await getDoc(adminRef);
            
            if (adminDoc.exists()) {
                const currentPasswordChangedAt = adminDoc.data().passwordChangedAt;
                
                if (currentPasswordChangedAt > tokenPasswordChangedAt) {
                    console.log('[PASSWORD CHANGE] Admin password changed - forcing logout');
                    return res.status(401).json({ 
                        error: 'Password was changed. Please login again.',
                        forceLogout: true 
                    });
                }
            }
        } else {
            const usersRef = collection(db, 'users');
            const q = query(usersRef, where('email', '==', req.user.email));
            const userSnapshot = await getDocs(q);
            
            if (!userSnapshot.empty) {
                const user = userSnapshot.docs[0].data();
                const currentPasswordChangedAt = user.passwordChangedAt || 0;
                
                if (currentPasswordChangedAt > tokenPasswordChangedAt) {
                    console.log('[PASSWORD CHANGE] User password changed - forcing logout');
                    return res.status(401).json({ 
                        error: 'Password was changed. Please login again.',
                        forceLogout: true 
                    });
                }
            }
        }
        
        next();
    } catch (error) {
        console.error('[PASSWORD VERIFY] Error:', error);
        return res.status(500).json({ error: 'Session verification failed' });
    }
}

/* =================================================================
 * AI ANALYTICS BOT ROUTES - FIXED
 * ================================================================= */

app.post('/api/analytics/get-sheets', authenticateAdmin, verifyPasswordNotChanged, async (req, res) => {
    try {
        const { banks, locations } = req.body;
        
        console.log('[GET-SHEETS] Received request with banks:', banks, 'locations:', locations);
        
        if (!banks || !locations || banks.length === 0 || locations.length === 0) {
            return res.status(400).json({ error: 'Banks and locations are required' });
        }
        
        let allSheets = [];
        
        for (const bank of banks) {
            for (const location of locations) {
                const cacheId = `${bank}_${location}`;
                const cacheRef = doc(db, 'analyticsSheetCache', cacheId);
                
                try {
                    const cacheSnap = await getDoc(cacheRef);
                    
                    if (cacheSnap.exists() && cacheSnap.data().sheets && cacheSnap.data().sheets.length > 0) {
                        console.log(`[GET-SHEETS] Cache HIT for ${cacheId}, returning ${cacheSnap.data().sheets.length} sheets instantly`);
                        allSheets = allSheets.concat(cacheSnap.data().sheets);
                    } else {
                        console.log(`[GET-SHEETS] Cache MISS for ${cacheId}, fetching from Storage...`);
                        const freshSheets = await listFilesFromStorage([bank], [location]);
                        
                        await setDoc(cacheRef, {
                            sheets: freshSheets,
                            cachedAt: Date.now(),
                            bank: bank,
                            location: location
                        });
                        
                        console.log(`[GET-SHEETS] Cached ${freshSheets.length} sheets for ${cacheId}`);
                        allSheets = allSheets.concat(freshSheets);
                    }
                } catch (cacheError) {
                    console.error(`[GET-SHEETS] Cache error for ${cacheId}:`, cacheError.message);
                    const freshSheets = await listFilesFromStorage([bank], [location]);
                    allSheets = allSheets.concat(freshSheets);
                }
            }
        }
        
        console.log('[GET-SHEETS] Returning', allSheets.length, 'sheets total');
        res.json({ sheets: allSheets, count: allSheets.length });
    } catch (error) {
        console.error('Error in /api/analytics/get-sheets:', error);
        res.status(500).json({ error: 'Failed to fetch sheets: ' + error.message });
    }
});
app.post('/api/analytics/refresh-cache', authenticateAdmin, verifyPasswordNotChanged, async (req, res) => {
    try {
        const { bank, location } = req.body;
        
        if (!bank || !location) {
            return res.status(400).json({ error: 'Bank and location are required' });
        }
        
        const cacheId = `${bank}_${location}`;
        const cacheRef = doc(db, 'analyticsSheetCache', cacheId);
        
        console.log(`[REFRESH-CACHE] Refreshing cache for ${cacheId}...`);
        
        const freshSheets = await listFilesFromStorage([bank], [location]);
        
        await setDoc(cacheRef, {
            sheets: freshSheets,
            cachedAt: Date.now(),
            bank: bank,
            location: location
        });
        
        console.log(`[REFRESH-CACHE] Cache refreshed with ${freshSheets.length} sheets`);
        res.json({ success: true, count: freshSheets.length, message: `Cache refreshed for ${bank} - ${location}` });
    } catch (error) {
        console.error('[REFRESH-CACHE] Error:', error);
        res.status(500).json({ error: 'Failed to refresh cache: ' + error.message });
    }
});
app.post('/api/analytics/clear-query-cache', authenticateAdmin, verifyPasswordNotChanged, async (req, res) => {
    try {
        const { banks, locations, areaMin, areaMax, questionKey, clearAll } = req.body;
        
        if (clearAll && Array.isArray(clearAll)) {
            const results = [];
            for (const cacheId of clearAll) {
                try {
                    const queryCacheRef = doc(db, 'analyticsQueryCache', cacheId);
                    await deleteDoc(queryCacheRef);
                    console.log(`[CLEAR-QUERY-CACHE] Deleted: ${cacheId}`);
                    results.push({ key: cacheId, success: true });
                } catch (err) {
                    console.log(`[CLEAR-QUERY-CACHE] Could not delete ${cacheId}:`, err.message);
                    results.push({ key: cacheId, success: false });
                }
            }
            return res.json({ success: true, results, message: `Cleared ${results.filter(r => r.success).length} cache(s)` });
        }

        let cacheId;
        if (questionKey) {
            cacheId = questionKey;
        } else {
            cacheId = `avg_bill_value_ICICI_${areaMin}_${areaMax}_${locations.sort().join('_')}`;
        }
        
        const queryCacheRef = doc(db, 'analyticsQueryCache', cacheId);
        await deleteDoc(queryCacheRef);
        
        console.log(`[CLEAR-QUERY-CACHE] Deleted cache: ${cacheId}`);
        res.json({ success: true, message: `Query cache cleared for ${cacheId}` });
    } catch (error) {
        console.error('[CLEAR-QUERY-CACHE] Error:', error);
        res.status(500).json({ error: 'Failed to clear query cache' });
    }
});
/* =================================================================
 * BOQ ANALYTICS QUERY ROUTE
 * ================================================================= */
/* =================================================================
 * BOQ ANALYTICS QUERY ROUTE
 * ================================================================= */
/* =================================================================
 * BOQ ANALYTICS QUERY ROUTE
 * ================================================================= */
app.post('/api/analytics/query', authenticateAdmin, verifyPasswordNotChanged, async (req, res) => {
    try {
        const { question, banks, locations } = req.body;
        
        // Redirect to cost analysis for area-based queries
        if (question.toLowerCase().includes('cost per sq ft') || 
            question.toLowerCase().includes('area of') ||
            question.toLowerCase().includes('area around')) {
            return req.app._router.handle(
                { ...req, url: '/api/analytics/cost-analysis', method: 'POST' },
                res,
                () => {}
            );
        }
        if (question.toLowerCase().includes('top 5 contractor') || 
    question.toLowerCase().includes('top contractor') ||
    question.toLowerCase().includes('repeated contractor')) {
    return req.app._router.handle(
        { ...req, url: '/api/analytics/top-contractors', method: 'POST' },
        res, () => {}
    );
}

if (question.toLowerCase().includes('ideal area') || 
    question.toLowerCase().includes('customer operations zone') ||
    question.toLowerCase().includes('operations zone wise')) {
    return req.app._router.handle(
        { ...req, url: '/api/analytics/ideal-area', method: 'POST' },
        res, () => {}
    );
}

if (question.toLowerCase().includes('branch savings') || 
    question.toLowerCase().includes('savings done') ||
    question.toLowerCase().includes('total savings')) {
    return req.app._router.handle(
        { ...req, url: '/api/analytics/branch-savings', method: 'POST' },
        res, () => {}
    );
}
        // Redirect to avg bill value analysis
        if (question.toLowerCase().includes('avg bill value')) {
            // ICICI goes to dedicated route, HDFC goes to cost-analysis
            if (banks.includes('ICICI') || banks.includes('icici')) {
                return req.app._router.handle(
                    { ...req, url: '/api/analytics/avg-bill-value', method: 'POST' },
                    res,
                    () => {}
                );
            } else {
                // HDFC avg bill value - goes to cost-analysis (will skip per-sqft)
                return req.app._router.handle(
                    { ...req, url: '/api/analytics/cost-analysis', method: 'POST' },
                    res,
                    () => {}
                );
            }
        }
        
        if (!question || !banks || !locations) {
            return res.status(400).json({ error: 'Missing required fields for query' });
        }

        console.log(`[AI Query] Analyzing question: "${question}"`);
        console.log(`[AI Query] Banks: ${banks}, Locations: ${locations}`);
        
        const filesToAnalyze = await listFilesFromStorage(banks, locations);
        
        console.log(`[AI Query] Found ${filesToAnalyze.length} files to analyze`);
        
        if (filesToAnalyze.length === 0) {
            return res.json({ 
                answer: "No files found for the selected bank and location combination.",
                sheetsAnalyzed: 0
            });
        }

        let allBoqData = [];
        let filesProcessed = 0;
        let detailedRecords = [];

        for (const file of filesToAnalyze) {
            try {
                console.log(`[AI Query] Processing file: ${file.fileName}`);
                
                const response = await axios.get(file.downloadURL, { 
                    responseType: 'arraybuffer',
                    timeout: 30000
                });
                
                const workbook = XLSX.read(response.data, { type: 'array' });
                
                let boqSheet = null;
                let boqSheetName = null;
                
                for (const sheetName of workbook.SheetNames) {
                    if (sheetName.toLowerCase().startsWith('boq')) {
                        boqSheet = workbook.Sheets[sheetName];
                        boqSheetName = sheetName;
                        break;
                    }
                }
                
                if (!boqSheet) {
                    console.log(`[AI Query] BOQ sheet not found in ${file.fileName}`);
                    continue;
                }
                
                const rawData = XLSX.utils.sheet_to_json(boqSheet, { 
                    header: 1,
                    defval: '',
                    raw: false 
                });
                
                // ENHANCED HEADER DETECTION
                let headerRowIndex = -1;
                let parentHeaderRow = [];
                let childHeaderRow = [];
                
                for (let i = 0; i < Math.min(10, rawData.length); i++) {
                    const row = rawData[i] || [];
                    const rowStr = row.join(' ').toLowerCase();
                    if (rowStr.includes('as per work order') || rowStr.includes('as per wo')) {
                        headerRowIndex = i;
                        parentHeaderRow = row;
                        childHeaderRow = rawData[i + 1] || [];
                        break;
                    }
                }
                
                if (headerRowIndex === -1) {
                    for (let i = 0; i < Math.min(10, rawData.length); i++) {
                        const row = rawData[i] || [];
                        const rowStr = row.join(' ').toLowerCase();
                        if (rowStr.includes('particulars')) {
                            headerRowIndex = i;
                            childHeaderRow = row;
                            parentHeaderRow = rawData[Math.max(0, i - 1)] || [];
                            break;
                        }
                    }
                }
                
                if (headerRowIndex === -1) {
                    console.log(`[AI Query] Headers not found in ${file.fileName}`);
                    continue;
                }
                
                const headers = [];
                const maxCols = Math.max(parentHeaderRow.length, childHeaderRow.length);
                
                for (let idx = 0; idx < maxCols; idx++) {
                    const parent = (parentHeaderRow[idx] || '').toString().trim();
                    const child = (childHeaderRow[idx] || '').toString().trim();
                    
                    if (parent.toLowerCase().includes('as per') || parent.toLowerCase().includes('work order')) {
                        if (child.toLowerCase() === 'amount' || child.toLowerCase() === 'amt') {
                            headers[idx] = 'WO Amount';
                        } else if (child.toLowerCase() === 'qty' || child.toLowerCase() === 'quantity') {
                            headers[idx] = 'WO Qty';
                        } else if (child.toLowerCase() === 'rate') {
                            headers[idx] = 'WO Rate';
                        } else if (child.toLowerCase() === 'unit') {
                            headers[idx] = 'WO Unit';
                        } else {
                            headers[idx] = parent + ' ' + child;
                        }
                    } else if (parent.toLowerCase().includes('cwi') || parent.toLowerCase().includes('round off')) {
                        if (child.toLowerCase() === 'amount' || child.toLowerCase() === 'amt') {
                            headers[idx] = 'CWI Amount';
                        } else if (child.toLowerCase() === 'qty' || child.toLowerCase() === 'quantity') {
                            headers[idx] = 'CWI Qty';
                        } else {
                            headers[idx] = parent + ' ' + child;
                        }
                    } else if (parent.toLowerCase().includes('excess') || child.toLowerCase().includes('excess')) {
                        headers[idx] = 'Excess';
                    } else if (child.toLowerCase() === 'particulars' || child.toLowerCase() === 'description') {
                        headers[idx] = 'Particulars';
                    } else if (child || parent) {
                        headers[idx] = child || parent;
                    } else {
                        headers[idx] = `Column_${idx}`;
                    }
                }
                
                console.log(`[AI Query] Final headers for ${file.fileName}:`, headers.slice(0, 15));
                
                const dataStartRow = headerRowIndex + (childHeaderRow.length > 0 ? 2 : 1);
                const jsonData = [];
                
                for (let i = dataStartRow; i < rawData.length; i++) {
                    const row = {};
                    rawData[i].forEach((cell, idx) => {
                        row[headers[idx]] = cell;
                    });
                    jsonData.push(row);
                }
                
                allBoqData.push({
                    fileName: file.fileName,
                    bank: file.bank,
                    location: file.location,
                    sheetName: boqSheetName,
                    data: jsonData,
                    rowCount: jsonData.length,
                    headers: headers
                });
                
                filesProcessed++;
                console.log(`[AI Query] Extracted ${jsonData.length} rows from ${file.fileName}`);

            } catch (parseError) {
                console.error(`[AI Query] Error processing ${file.fileName}:`, parseError.message);
            }
        }

        console.log(`[AI Query] Analysis complete. Files processed: ${filesProcessed}`);

        if (filesProcessed === 0) {
            return res.json({ 
                answer: `No BOQ sheets found in ${filesToAnalyze.length} files.`,
                sheetsAnalyzed: 0
            });
        }

        const aggregatedData = {};
        let totalRowsProcessed = 0;

        allBoqData.forEach(fileData => {
            fileData.data.forEach((row, rowIdx) => {
                totalRowsProcessed++;
                
                const particulars = row['Particulars'] || 
                                  row['Description'] || 
                                  row['Item Description'] ||
                                  row['Work Description'] ||
                                  Object.values(row)[1];
                
                const woAmount = parseFloat(row['WO Amount']) || 
                               parseFloat(row['As per Work Order Amount']) ||
                               parseFloat(row['As Per WO Amount']) || 0;
                               
                const cwiAmount = parseFloat(row['CWI Amount']) || 
                                parseFloat(row['Round Off Amount']) || 0;
                                
                const excess = parseFloat(row['Excess']) || 
                             parseFloat(row['Excess Amount']) || 0;
                
                const rowValues = Object.values(row);
                let woAmountByPosition = 0;
                
                for (let i = 4; i < Math.min(8, rowValues.length); i++) {
                    const val = parseFloat(rowValues[i]);
                    if (val > 0 && fileData.headers[i] && 
                        (fileData.headers[i].toLowerCase().includes('amount') || 
                         fileData.headers[i].toLowerCase().includes('amt'))) {
                        woAmountByPosition = val;
                        break;
                    }
                }
                
                const finalWOAmount = woAmount || woAmountByPosition;
                const finalCWIAmount = cwiAmount || (finalWOAmount > 0 && excess > 0 ? finalWOAmount + excess : cwiAmount);
                const finalExcess = excess || (finalCWIAmount > finalWOAmount ? finalCWIAmount - finalWOAmount : 0);
                
                if (particulars && 
                    particulars.toString().trim().length > 3 && 
                    !particulars.toString().toLowerCase().includes('total') &&
                    !particulars.toString().toLowerCase().includes('civil & related') &&
                    !particulars.toString().toLowerCase().includes('demolition') &&
                    !particulars.toString().toLowerCase().match(/^[a-z]$/i) &&
                    !particulars.toString().trim().match(/^[ivxlcdm]+$/i) &&
                    (finalWOAmount > 0 || finalCWIAmount > 0)) {
                    
                    const category = particulars.toString().trim();
                    
                    detailedRecords.push({
                        fileName: fileData.fileName,
                        bank: fileData.bank,
                        location: fileData.location,
                        particulars: category,
                        woAmount: finalWOAmount,
                        cwiAmount: finalCWIAmount,
                        excess: finalExcess,
                        percentIncrease: finalWOAmount > 0 ? ((finalCWIAmount - finalWOAmount) / finalWOAmount * 100) : 0
                    });
                    
                    if (!aggregatedData[category]) {
                        aggregatedData[category] = {
                            totalExcess: 0,
                            totalWO: 0,
                            totalCWI: 0,
                            occurrences: 0,
                            files: new Set(),
                            fileDetails: []
                        };
                    }
                    
                    aggregatedData[category].totalExcess += finalExcess;
                    aggregatedData[category].totalWO += finalWOAmount;
                    aggregatedData[category].totalCWI += finalCWIAmount;
                    aggregatedData[category].occurrences += 1;
                    aggregatedData[category].files.add(fileData.fileName);
                    aggregatedData[category].fileDetails.push({
                        fileName: fileData.fileName,
                        woAmount: finalWOAmount,
                        cwiAmount: finalCWIAmount,
                        excess: finalExcess
                    });
                }
            });
        });

        const sortedCategories = Object.entries(aggregatedData)
            .map(([category, data]) => ({
                category, 
                totalExcess: data.totalExcess,
                totalWO: data.totalWO,
                totalCWI: data.totalCWI,
                occurrences: data.occurrences,
                filesCount: data.files.size,
                files: Array.from(data.files),
                fileDetails: data.fileDetails,
                percentageIncrease: data.totalWO > 0 ? ((data.totalCWI - data.totalWO) / data.totalWO * 100) : 0
            }))
            .sort((a, b) => b.totalExcess - a.totalExcess)
            .slice(0, 20);

        console.log(`[AI Query] Categories found:`, sortedCategories.length);
        
        const excelWorkbook = XLSX.utils.book_new();
        
        const summaryData = sortedCategories.map((cat, idx) => ({
            'Rank': idx + 1,
            'Work Category': cat.category,
            'Total WO Amount (₹)': cat.totalWO.toFixed(2),
            'Total CWI Amount (₹)': cat.totalCWI.toFixed(2),
            'Total Excess (₹)': cat.totalExcess.toFixed(2),
            '% Increase': cat.percentageIncrease.toFixed(2) + '%',
            'Occurrences': cat.occurrences,
            'Files Count': cat.filesCount,
            'Source Files': cat.files.join(', ')
        }));
        
        const summarySheet = XLSX.utils.json_to_sheet(summaryData);
        XLSX.utils.book_append_sheet(excelWorkbook, summarySheet, 'Summary');
        
        const detailData = detailedRecords
            .sort((a, b) => b.excess - a.excess)
            .map(record => ({
                'File Name': record.fileName,
                'Bank': record.bank,
                'Location': record.location,
                'Work Description': record.particulars,
                'WO Amount (₹)': record.woAmount.toFixed(2),
                'CWI Amount (₹)': record.cwiAmount.toFixed(2),
                'Excess (₹)': record.excess.toFixed(2),
                '% Increase': record.percentIncrease.toFixed(2) + '%'
            }));
        
        const detailSheet = XLSX.utils.json_to_sheet(detailData);
        XLSX.utils.book_append_sheet(excelWorkbook, detailSheet, 'Detailed Records');
        
        const fileWiseSummary = {};
        detailedRecords.forEach(record => {
            if (!fileWiseSummary[record.fileName]) {
                fileWiseSummary[record.fileName] = {
                    totalWO: 0,
                    totalCWI: 0,
                    totalExcess: 0,
                    itemCount: 0
                };
            }
            fileWiseSummary[record.fileName].totalWO += record.woAmount;
            fileWiseSummary[record.fileName].totalCWI += record.cwiAmount;
            fileWiseSummary[record.fileName].totalExcess += record.excess;
            fileWiseSummary[record.fileName].itemCount += 1;
        });
        
        const fileData = Object.entries(fileWiseSummary).map(([fileName, data]) => ({
            'File Name': fileName,
            'Items Analyzed': data.itemCount,
            'Total WO Amount (₹)': data.totalWO.toFixed(2),
            'Total CWI Amount (₹)': data.totalCWI.toFixed(2),
            'Total Excess (₹)': data.totalExcess.toFixed(2),
            'Avg % Increase': data.totalWO > 0 ? ((data.totalCWI - data.totalWO) / data.totalWO * 100).toFixed(2) + '%' : 'N/A'
        }));
        
        const fileSheet = XLSX.utils.json_to_sheet(fileData);
        XLSX.utils.book_append_sheet(excelWorkbook, fileSheet, 'File Summary');
        
        const excelBuffer = XLSX.write(excelWorkbook, { type: 'buffer', bookType: 'xlsx' });
        
        let aiAnswer = '';
        
        if (sortedCategories.length === 0) {
            aiAnswer = `No excess categories found after processing ${filesProcessed} files. All work appears to be within budget.`;
        } else {
            const topCategory = sortedCategories[0];
            
            aiAnswer = `## BOQ Analysis Results

### Highest Excess Work Category:
**"${topCategory.category}"**

#### Financial Details:
- **Original Work Order Amount:** ₹${topCategory.totalWO.toLocaleString('en-IN', {minimumFractionDigits: 2})}
- **CWI/Final Amount:** ₹${topCategory.totalCWI.toLocaleString('en-IN', {minimumFractionDigits: 2})}
- **Total Excess:** ₹${topCategory.totalExcess.toLocaleString('en-IN', {minimumFractionDigits: 2})}
- **Percentage Increase:** ${topCategory.percentageIncrease.toFixed(2)}%

#### Source Information:
- **Found in ${topCategory.filesCount} file(s):** ${topCategory.files.join(', ')}
- **Total Occurrences:** ${topCategory.occurrences}

### Top 5 Categories by Excess Amount:

`;
            
            sortedCategories.slice(0, 5).forEach((cat, idx) => {
                aiAnswer += `
**${idx + 1}. ${cat.category}**
- WO: ₹${cat.totalWO.toLocaleString('en-IN', {minimumFractionDigits: 2})}
- CWI: ₹${cat.totalCWI.toLocaleString('en-IN', {minimumFractionDigits: 2})}
- Excess: ₹${cat.totalExcess.toLocaleString('en-IN', {minimumFractionDigits: 2})} (${cat.percentageIncrease.toFixed(2)}% increase)
- Files: ${cat.files.join(', ')}
`;
            });
            
            aiAnswer += `

### Summary:
- **Files Analyzed:** ${filesProcessed}
- **Total Rows Processed:** ${totalRowsProcessed}
- **Categories with Excess:** ${sortedCategories.length}

**Note:** A detailed Excel report has been generated with complete file-by-file breakdown.`;
        }
        
        res.json({
            answer: aiAnswer,
            sheetsAnalyzed: filesProcessed,
            totalRows: totalRowsProcessed,
            categoriesAnalyzed: sortedCategories.length,
            excelReport: excelBuffer.toString('base64'),
            excelFileName: `BOQ_Analysis_${banks.join('_')}_${new Date().toISOString().split('T')[0]}.xlsx`
        });
        
    } catch (error) {
        console.error('Error processing AI query:', error);
        
        if (error.status === 429) {
            return res.status(429).json({ 
                error: 'Rate limit exceeded. Wait 30 seconds.',
                retryAfter: 30
            });
        }
        
        res.status(500).json({ 
            error: 'Failed to process query: ' + error.message
        });
    }
});

app.post('/api/refresh-token', authenticateToken, async (req, res) => {
    try {
        // Token is still valid (checked by authenticateToken middleware)
        // Issue a new token with extended expiry
        
        if (req.user.role === 'admin') {
            const adminRef = doc(db, 'adminConfig', 'credentials');
            const adminDoc = await getDoc(adminRef);
            
            const passwordChangedAt = adminDoc.exists() 
                ? adminDoc.data().passwordChangedAt 
                : Date.now();
            
            const newToken = jwt.sign({
                email: req.user.email,
                name: req.user.name,
                role: 'admin',
                passwordChangedAt: passwordChangedAt
            }, JWT_SECRET, { expiresIn: '1d' });
            
            return res.json({ token: newToken, name: req.user.name });
        } else {
            const usersRef = collection(db, 'users');
            const q = query(usersRef, where('email', '==', req.user.email));
            const userSnapshot = await getDocs(q);
            
            if (userSnapshot.empty) {
                return res.status(404).json({ 
                    error: 'User not found',
                    forceLogout: true 
                });
            }
            
            const userDoc = userSnapshot.docs[0];
            const user = userDoc.data();
            const passwordChangedAt = user.passwordChangedAt || Date.now();
            
            const newToken = jwt.sign({
                email: user.email,
                name: user.name,
                id: userDoc.id,
                role: 'user',
                passwordChangedAt: passwordChangedAt
            }, JWT_SECRET, { expiresIn: '1d' });
            
            return res.json({ token: newToken, name: user.name });
        }
    } catch (error) {
        console.error('[TOKEN REFRESH] Error:', error);
        res.status(500).json({ error: 'Failed to refresh token' });
    }
});

/* =================================================================
 * COST ANALYSIS ROUTE - KEY CHANGE: Detects "avg bill value" 
 * ================================================================= */
app.post('/api/analytics/cost-analysis', authenticateAdmin, verifyPasswordNotChanged, async (req, res) => {
    try {
        const { question, banks, locations } = req.body;
        
        console.log(`[Cost Analysis] Question: "${question}"`);
        
        // **KEY CHANGE**: Check if this is "avg bill value" (no per-sqft division needed)
        const isAvgBillValue = question.toLowerCase().includes('avg bill value');
        
        let areaFilter = {
            type: 'exact',
            min: 0,
            max: Infinity,
            target: null
        };
        
        if (question.includes('2200') || question.includes('around 2200')) {
            areaFilter = { type: 'around', min: 2000, max: 2500, target: 2200 };
        } else if (question.includes('3000 sqft') || question.includes('area of 3000')) {
            areaFilter = { type: 'exact', target: 3000, min: 2900, max: 3100 };
        } else if (question.includes('3000-3500') || question.includes('3000 to 3500')) {
            areaFilter = { type: 'range', min: 3000, max: 3500 };
        }
        
        const filesToAnalyze = await listFilesFromStorage(banks, locations);
        
        if (filesToAnalyze.length === 0) {
            return res.json({ 
                answer: "No files found for the selected criteria.",
                sheetsAnalyzed: 0
            });
        }

        const results = [];
        let filesProcessed = 0;

        for (const file of filesToAnalyze) {
            try {
                console.log(`[Cost Analysis] Processing: ${file.fileName}`);
                
                const response = await axios.get(file.downloadURL, { 
                    responseType: 'arraybuffer',
                    timeout: 30000
                });
                
                const workbook = XLSX.read(response.data, { type: 'array' });
                
                let area = null;
                
                const fileNameMatch = file.fileName.match(/_(\d{3,5})sqft_/i);   // NEW: Matches _1644sqft_
     file.fileName.match(/^(\d{3,5})sqft/i) ||
     file.fileName.match(/(\d{3,5})\s*sq\.?\s*ft/i) || 
     file.fileName.match(/(\d{3,5})sqft/i) ||
     file.fileName.match(/_(\d{3,5})_/);
                if (fileNameMatch) {
                    area = parseInt(fileNameMatch[1]);
                    console.log(`[Cost Analysis] Area from filename: ${area} sqft`);
                }
                
                if (!area) {
                    const measurementSheet = workbook.Sheets['Measurement Sheet'] || 
                                           workbook.Sheets['Measurement sheet'] ||
                                           workbook.Sheets['measurement sheet'];
                    
                    if (measurementSheet) {
                        const range = XLSX.utils.decode_range(measurementSheet['!ref']);
                        
                        for (let row = 0; row <= Math.min(10, range.e.r); row++) {
                            for (let col = range.s.c; col <= range.e.c; col++) {
                                const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
                                const cell = measurementSheet[cellAddress];
                                if (cell && cell.v) {
                                    const cellValue = cell.v.toString();
                                    
                                    const patterns = [
                                        /(\d{3,5})\s*sq\.?\s*ft/i,
                                        /(\d{3,5})sqft/i,
                                        /area[:\s]*(\d{3,5})/i,
                                        /carpet[:\s]*(\d{3,5})/i
                                    ];
                                    
                                    for (const pattern of patterns) {
                                        const match = cellValue.match(pattern);
                                        if (match) {
                                            area = parseInt(match[1]);
                                            console.log(`[Cost Analysis] Area from sheet: ${area} sqft`);
                                            break;
                                        }
                                    }
                                    if (area) break;
                                }
                            }
                            if (area) break;
                        }
                    }
                }
                
                if (!area) {
                    console.log(`[Cost Analysis] No area found in ${file.fileName}, skipping`);
                    continue;
                }
                
                let matchesFilter = false;
                
                if (areaFilter.type === 'exact') {
                    matchesFilter = (area >= areaFilter.min && area <= areaFilter.max);
                } else if (areaFilter.type === 'around' || areaFilter.type === 'range') {
                    matchesFilter = (area >= areaFilter.min && area <= areaFilter.max);
                }
                
                if (!matchesFilter) {
                    console.log(`[Cost Analysis] Area ${area} doesn't match filter, skipping`);
                    continue;
                }
                
                console.log(`[Cost Analysis] ✅ Area ${area} matches criteria for ${file.fileName}`);
                
                let summarySheet = null;
                let summarySheetName = null;
                
                for (const sheetName of workbook.SheetNames) {
                    const lowerName = sheetName.toLowerCase();
                    if (lowerName.includes('summary sheet') || 
                        (lowerName.includes('summary') && !lowerName.includes('general'))) {
                        summarySheet = workbook.Sheets[sheetName];
                        summarySheetName = sheetName;
                        console.log(`[Cost Analysis] Using summary sheet: ${sheetName}`);
                        break;
                    }
                }
                
                if (!summarySheet) {
                    console.log(`[Cost Analysis] No summary sheet in ${file.fileName}`);
                    continue;
                }
                
                const rawData = XLSX.utils.sheet_to_json(summarySheet, { 
                    header: 1,
                    defval: '',
                    raw: false 
                });
                
                const compactData = rawData.slice(0, 50).map((row, idx) => ({
                    row: idx,
                    data: row.slice(0, 15)
                }));
                
                const geminiPrompt = `You are analyzing a BOQ Summary Sheet. Extract amounts from "As Per CWI Amount (Rs)" column for each work category.

**EXCEL DATA (first 50 rows, first 15 columns):**
${JSON.stringify(compactData, null, 2)}

**YOUR TASK:**
Extract category names and their CWI amounts. Return ONLY a valid JSON object (no markdown, no explanation, no text before or after):

{
  "Civil & related works": amount_as_number,
  "POP and False Ceiling Work": amount_as_number,
  "Carpentry and Interior works": amount_as_number,
  "Painting works": amount_as_number,
  "Rolling Shutter and MS Work": amount_as_number,
  "Electrification and Allied Works": amount_as_number,
  "Accessibility related work": amount_as_number,
  "Additional work": amount_as_number,
  "TOTAL (Excl Taxes)": amount_as_number
}

**RULES:**
1. Look for columns with "As per CWI" or "CWI Amount" in headers
2. Match category names from "Particulars" column
3. Return amounts as numbers (remove commas, ₹ symbols)
4. If category not found, omit it from JSON
5. Return ONLY the JSON object, nothing else`;

                console.log('[Cost Analysis] Calling Gemini 2.5 Pro API...');
                
                const { GoogleGenerativeAI } = require('@google/generative-ai');
                const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
                
                const model = genAI.getGenerativeModel({ 
                   model: 'gemini-1.5-flash',
                    generationConfig: {
                        temperature: 0.1,
                        maxOutputTokens: 2048,
                        responseMimeType: "application/json"
                    }
                });
                
                const result = await model.generateContent(geminiPrompt);
                const geminiResponse = await result.response;
                let categoryData = {};

                try {
                    const responseText = geminiResponse.text();
                    console.log('[Cost Analysis] Gemini raw response:', responseText.substring(0, 200));
                    
                    const cleanedText = responseText
                        .replace(/```json\n?/g, '')
                        .replace(/```\n?/g, '')
                        .trim();
                    
                    categoryData = JSON.parse(cleanedText);
                    console.log('[Cost Analysis] Gemini extracted:', Object.keys(categoryData).length, 'categories');
                    
                } catch (parseError) {
                    console.error('[Cost Analysis] Failed to parse Gemini response:', parseError.message);
                    console.error('[Cost Analysis] Response was:', geminiResponse.text().substring(0, 500));
                    continue;
                }
                
                const fileResult = {
                    fileName: file.fileName.replace('.xlsx', ''),
                    area: area,
                    categories: {}
                };
                
                for (const [category, amount] of Object.entries(categoryData)) {
                    if (typeof amount === 'number' && amount > 0) {
                        fileResult.categories[category] = {
                            amount: amount,
                            // **KEY CHANGE**: Only calculate costPerSqft if NOT avg bill value
                            costPerSqft: isAvgBillValue ? null : (amount / area).toFixed(2)
                        };
                    }
                }
                
                results.push(fileResult);
                filesProcessed++;
                
            } catch (error) {
                console.error(`[Cost Analysis] Error processing ${file.fileName}:`, error.message);
            }
        }
        
        if (results.length === 0) {
            return res.json({
                answer: `No branches found matching area criteria (${areaFilter.type}: ${areaFilter.min}-${areaFilter.max} sqft).\n\nProcessed ${filesToAnalyze.length} files but none matched the area range.`,
                sheetsAnalyzed: filesProcessed
            });
        }
        
        const ExcelJS = require('exceljs');
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet(isAvgBillValue ? 'Avg Bill Value' : 'Cost Analysis');
        
        const allCategories = new Set();
        results.forEach(r => Object.keys(r.categories).forEach(c => allCategories.add(c)));
        const categoriesArray = Array.from(allCategories).sort();
        
        let headerRow = ['File Name', 'Area (sqft)'];
        
        if (isAvgBillValue) {
            // **For avg bill value**: Show ALL category amounts (no cost/sqft for any)
            categoriesArray.forEach(cat => {
                headerRow.push(`${cat} - Amount (₹)`);
            });
        } else {
            // **For cost per sqft**: Individual categories (amount only), TOTAL with both
            categoriesArray.forEach(cat => {
                if (cat !== 'TOTAL (Excl Taxes)') {
                    headerRow.push(`${cat} - Amount (₹)`);
                }
            });
            headerRow.push('TOTAL (Excl Taxes) - Amount (₹)');
            headerRow.push('TOTAL (Excl Taxes) - Cost/sqft (₹)');
        }
        
        worksheet.addRow(headerRow);
        
        worksheet.getRow(1).font = { bold: true };
        worksheet.getRow(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF4472C4' }
        };
        worksheet.getRow(1).alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' };
        
        results.forEach(result => {
            const row = [result.fileName, result.area];
            
            if (isAvgBillValue) {
                // For avg bill value: Add all category amounts (no cost/sqft)
                categoriesArray.forEach(cat => {
                    const data = result.categories[cat];
                    row.push(data ? parseFloat(data.amount) : '-');
                });
            } else {
                // For cost per sqft: Individual categories (amount only)
                categoriesArray.forEach(cat => {
                    if (cat !== 'TOTAL (Excl Taxes)') {
                        const data = result.categories[cat];
                        row.push(data ? parseFloat(data.amount) : '-');
                    }
                });
                
                const totalData = result.categories['TOTAL (Excl Taxes)'];
                if (totalData) {
                    row.push(parseFloat(totalData.amount));
                    row.push(parseFloat(totalData.costPerSqft));
                } else {
                    row.push('-');
                    row.push('-');
                }
            }
            
            worksheet.addRow(row);
        });
        
        if (!isAvgBillValue) {
            const totalAmountCol = headerRow.length - 1;
            const totalCostCol = headerRow.length;
            
            worksheet.getColumn(totalAmountCol).eachCell((cell, rowNumber) => {
                if (rowNumber > 1) {
                    cell.fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: 'FFFFFF00' }
                    };
                }
            });
            
            worksheet.getColumn(totalCostCol).eachCell((cell, rowNumber) => {
                if (rowNumber > 1) {
                    cell.fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: 'FFFFFF00' }
                    };
                }
            });
        }
        
        worksheet.addRow([]);
        const avgRow = ['AVERAGE', '-'];
        
        if (isAvgBillValue) {
            categoriesArray.forEach(cat => {
                const amounts = results.map(r => r.categories[cat]?.amount || 0).filter(a => a > 0);
                avgRow.push(amounts.length > 0 ? (amounts.reduce((a,b) => a+b, 0) / amounts.length).toFixed(2) : '-');
            });
        } else {
            categoriesArray.forEach(cat => {
                if (cat !== 'TOTAL (Excl Taxes)') {
                    const amounts = results.map(r => r.categories[cat]?.amount || 0).filter(a => a > 0);
                    avgRow.push(amounts.length > 0 ? (amounts.reduce((a,b) => a+b, 0) / amounts.length).toFixed(2) : '-');
                }
            });
            
            const totalAmounts = results.map(r => r.categories['TOTAL (Excl Taxes)']?.amount || 0).filter(a => a > 0);
            const totalCosts = results.map(r => parseFloat(r.categories['TOTAL (Excl Taxes)']?.costPerSqft) || 0).filter(c => c > 0);
            
            avgRow.push(totalAmounts.length > 0 ? (totalAmounts.reduce((a,b) => a+b, 0) / totalAmounts.length).toFixed(2) : '-');
            avgRow.push(totalCosts.length > 0 ? (totalCosts.reduce((a,b) => a+b, 0) / totalCosts.length).toFixed(2) : '-');
        }
        
        const avgRowObj = worksheet.addRow(avgRow);
        avgRowObj.font = { bold: true };
        avgRowObj.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFFFEB3B' }
        };
        
        worksheet.columns.forEach(column => {
            column.width = 20;
        });
        
        const buffer = await workbook.xlsx.writeBuffer();
        const base64Excel = buffer.toString('base64');
        
        let answer = '';
        
        if (isAvgBillValue) {
            answer = `📊 **Average Bill Value Analysis**\n\n`;
            answer += `**Criteria:** Area ${areaFilter.min}-${areaFilter.max} sqft\n`;
            answer += `**Branches Found:** ${results.length}\n`;
            answer += `**Banks:** ${banks.join(', ')}\n`;
            answer += `**Locations:** ${locations.join(', ')}\n\n`;
            
            answer += `### 📋 **Branch-wise Details:**\n\n`;
            results.forEach((result, idx) => {
                answer += `**${idx + 1}. ${result.fileName}** (${result.area} sqft)\n`;
                Object.entries(result.categories).forEach(([cat, data]) => {
                    answer += `   • ${cat}: ₹${parseFloat(data.amount).toLocaleString('en-IN')}\n`;
                });
                answer += `\n`;
            });
            
            answer += `\n### 📈 **Average Values Across All Branches:**\n`;
            categoriesArray.forEach(cat => {
                const amounts = results.map(r => r.categories[cat]?.amount || 0).filter(a => a > 0);
                if (amounts.length > 0) {
                    const avgAmount = amounts.reduce((a,b) => a+b, 0) / amounts.length;
                    answer += `   • **${cat}:** ₹${avgAmount.toLocaleString('en-IN', {minimumFractionDigits: 2})}\n`;
                }
            });
            
        } else {
            answer = `📊 **Cost Analysis Report**\n\n`;
            answer += `**Criteria:** Area ${areaFilter.min}-${areaFilter.max} sqft\n`;
            answer += `**Branches Found:** ${results.length}\n`;
            answer += `**Banks:** ${banks.join(', ')}\n`;
            answer += `**Locations:** ${locations.join(', ')}\n\n`;
            answer += `**Detailed Breakdown:**\n\n`;
            
            results.forEach((result, idx) => {
                answer += `**${idx + 1}. ${result.fileName}** (${result.area} sqft)\n`;
                
                Object.entries(result.categories).forEach(([cat, data]) => {
                    if (cat !== 'TOTAL (Excl Taxes)') {
                        answer += `   • ${cat}: ₹${parseFloat(data.amount).toLocaleString('en-IN')}\n`;
                    }
                });
                
                const totalData = result.categories['TOTAL (Excl Taxes)'];
                if (totalData) {
                    answer += `   • **TOTAL: ₹${parseFloat(totalData.amount).toLocaleString('en-IN')} (₹${totalData.costPerSqft}/sqft)**\n`;
                }
                answer += `\n`;
            });
            
            answer += `\n**Average Values:**\n`;
            
            categoriesArray.forEach(cat => {
                if (cat !== 'TOTAL (Excl Taxes)') {
                    const amounts = results.map(r => r.categories[cat]?.amount || 0).filter(a => a > 0);
                    if (amounts.length > 0) {
                        const avgAmount = amounts.reduce((a,b) => a+b, 0) / amounts.length;
                        answer += `   • ${cat}: ₹${avgAmount.toLocaleString('en-IN', {minimumFractionDigits: 2})}\n`;
                    }
                }
            });
            
            const totalAmounts = results.map(r => r.categories['TOTAL (Excl Taxes)']?.amount || 0).filter(a => a > 0);
            const totalCosts = results.map(r => parseFloat(r.categories['TOTAL (Excl Taxes)']?.costPerSqft) || 0).filter(c => c > 0);
            
            if (totalAmounts.length > 0) {
                const avgAmount = totalAmounts.reduce((a,b) => a+b, 0) / totalAmounts.length;
                const avgCost = totalCosts.reduce((a,b) => a+b, 0) / totalCosts.length;
                answer += `   • **TOTAL: ₹${avgAmount.toLocaleString('en-IN', {minimumFractionDigits: 2})} (₹${avgCost.toFixed(2)}/sqft)**\n`;
            }
        }
        
        answer += `\n📥 **Excel report generated and ready for download!**`;
        
        res.json({
            answer: answer,
            sheetsAnalyzed: results.length,
            totalFilesProcessed: filesToAnalyze.length,
            excelReport: base64Excel,
            excelFileName: isAvgBillValue 
                ? `Avg_Bill_Value_${banks.join('_')}_${areaFilter.min}_${areaFilter.max}_sqft_${new Date().toISOString().split('T')[0]}.xlsx`
                : `Cost_Analysis_${areaFilter.min}_${areaFilter.max}_sqft_${new Date().toISOString().split('T')[0]}.xlsx`
        });
        
    } catch (error) {
        console.error('[Cost Analysis] Error:', error);
        res.status(500).json({ 
            error: 'Failed to process cost analysis: ' + error.message
        });
    }
});

/* =================================================================
 * AVG BILL VALUE ROUTE - ICICI Only (TOTAL only)
 * ================================================================= */
/* =================================================================
 * AVG BILL VALUE ROUTE - ICICI Only (TOTAL only) - NO AI
 * ================================================================= */
app.post('/api/analytics/avg-bill-value', authenticateAdmin, verifyPasswordNotChanged, async (req, res) => {
    try {
        const { question, banks, locations } = req.body;
        
        console.log(`[Avg Bill Value] Question: "${question}"`);
        console.log(`[Avg Bill Value] Banks: ${banks}`);
        
        if (!banks.includes('ICICI') && !banks.includes('icici')) {
            return res.json({
                answer: "⚠️ **Avg bill value analysis is only applicable for ICICI bank.**\n\nPlease select ICICI bank and try again.",
                sheetsAnalyzed: 0
            });
        }
        
        let areaFilter = {
            min: 0,
            max: Infinity
        };
        
        const rangeMatch = question.match(/(\d{3,5})\s*-\s*(\d{3,5})/);
        if (rangeMatch) {
            areaFilter.min = parseInt(rangeMatch[1]);
            areaFilter.max = parseInt(rangeMatch[2]);
        } else if (question.includes('1600') && question.includes('1800')) {
            areaFilter.min = 1600;
            areaFilter.max = 1800;
        }
        
        console.log(`[Avg Bill Value] Area range: ${areaFilter.min}-${areaFilter.max} sqft`);

// Check Firestore query cache first
try {
    const queryCacheId = `avg_bill_value_ICICI_${areaFilter.min}_${areaFilter.max}_${locations.sort().join('_')}`;
    const queryCacheRef = doc(db, 'analyticsQueryCache', queryCacheId);
    const queryCacheSnap = await getDoc(queryCacheRef);
    
    if (queryCacheSnap.exists() && queryCacheSnap.data().answer) {
    console.log(`[Avg Bill Value] ✅ Cache HIT - returning saved result instantly`);
    const cached = queryCacheSnap.data();
    return res.json({
            answer: cached.answer,
            sheetsAnalyzed: cached.sheetsAnalyzed,
            totalFilesProcessed: cached.totalFilesProcessed,
            avgBillValue: cached.avgBillValue,
            minBillValue: cached.minBillValue,
            maxBillValue: cached.maxBillValue,
            excelReport: cached.excelReport,
            excelFileName: cached.excelFileName,
            fromCache: true
        });
    }
    console.log(`[Avg Bill Value] Cache MISS - processing fresh...`);
} catch (cacheCheckErr) {
    console.error('[Avg Bill Value] Cache check failed:', cacheCheckErr.message);
}

const filesToAnalyze = await listFilesFromStorage(banks, locations);
        
        if (filesToAnalyze.length === 0) {
            return res.json({ 
                answer: "No ICICI files found for the selected criteria.",
                sheetsAnalyzed: 0
            });
        }

        const results = [];
let filesProcessed = 0;
const billValues = [];
const seenAreas = new Map(); // key = area, value = array of results for that area

        for (const file of filesToAnalyze) {
            try {
                console.log(`[Avg Bill Value] Processing: ${file.fileName}`);
                
                const response = await axios.get(file.downloadURL, { 
                    responseType: 'arraybuffer',
                    timeout: 30000
                });
                
                const workbook = XLSX.read(response.data, { type: 'array' });
                
                let area = null;
                
                const fileNameMatch = file.fileName.match(/_(\d{3,5})sqft_/i);
                if (fileNameMatch) {
                    area = parseInt(fileNameMatch[1]);
                }
                
                if (!area) {
                    const measurementSheet = workbook.Sheets['Measurement Sheet'] || 
                                           workbook.Sheets['Measurement sheet'] ||
                                           workbook.Sheets['measurement sheet'];
                    
                    if (measurementSheet) {
                        const range = XLSX.utils.decode_range(measurementSheet['!ref']);
                        
                        for (let row = 0; row <= Math.min(10, range.e.r); row++) {
                            for (let col = range.s.c; col <= range.e.c; col++) {
                                const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
                                const cell = measurementSheet[cellAddress];
                                if (cell && cell.v) {
                                    const cellValue = cell.v.toString();
                                    const match = cellValue.match(/(\d{3,5})\s*sq\.?\s*ft/i);
                                    if (match) {
                                        area = parseInt(match[1]);
                                        break;
                                    }
                                }
                            }
                            if (area) break;
                        }
                    }
                }
                
                if (!area) {
                    console.log(`[Avg Bill Value] No area found in ${file.fileName}, skipping`);
                    continue;
                }
                
                if (area < areaFilter.min || area > areaFilter.max) {
                    console.log(`[Avg Bill Value] Area ${area} outside range, skipping`);
                    continue;
                }
                
                console.log(`[Avg Bill Value] ✅ Area ${area} matches range for ${file.fileName}`);
                
                let summarySheet = null;
                
                for (const sheetName of workbook.SheetNames) {
                    const lowerName = sheetName.toLowerCase();
                    if (lowerName.includes('summary sheet') || 
                        (lowerName.includes('summary') && !lowerName.includes('general'))) {
                        summarySheet = workbook.Sheets[sheetName];
                        break;
                    }
                }
                
                if (!summarySheet) {
                    console.log(`[Avg Bill Value] No summary sheet in ${file.fileName}`);
                    continue;
                }
                
                const rawData = XLSX.utils.sheet_to_json(summarySheet, { 
                    header: 1,
                    defval: '',
                    raw: false 
                });
                
                // ✅ DIRECT EXCEL PARSING - NO AI NEEDED
                // ✅ DIRECT EXCEL PARSING - Search column B for "TOTAL"
let totalAmount = null;

// First scan headers to find CWI and Post Audit column indices
let cwiColumnIndex = 3; // default column D
let postAuditColumnIndex = -1;
let headerFoundAt = -1;

for (let i = 0; i < Math.min(15, rawData.length); i++) {
    const row = rawData[i] || [];
    const rowStr = row.join(' ').toLowerCase();
    if (rowStr.includes('as per cwi') || rowStr.includes('as per wo') || rowStr.includes('particulars')) {
        headerFoundAt = i;
        for (let c = 0; c < row.length; c++) {
            const cellStr = (row[c] || '').toString().toLowerCase();
            if (cellStr.includes('cwi') && (cellStr.includes('amount') || cellStr.includes('amt'))) {
                cwiColumnIndex = c;
            }
            if (cellStr.includes('post audit') && (cellStr.includes('amount') || cellStr.includes('amt'))) {
                postAuditColumnIndex = c;
            }
        }
        break;
    }
}

console.log(`[Avg Bill Value] Header at row ${headerFoundAt}, CWI col: ${cwiColumnIndex}, PostAudit col: ${postAuditColumnIndex}`);

// Try to find TOTAL row in column B
for (let i = 0; i < rawData.length; i++) {
    const row = rawData[i];
    const colB = (row[1] || '').toString().trim().toLowerCase();
    
    if (colB === 'total' || 
        (colB.includes('total') && !colB.includes('sub') && !colB.includes('grand'))) {
        
        console.log(`[Avg Bill Value] Found TOTAL row at index ${i}:`, row.slice(0, 10));
        
        // Try CWI column first
        let amountCell = row[cwiColumnIndex];
        
        // If CWI is empty or zero, try Post Audit column
        if ((!amountCell || parseFloat(amountCell.toString().replace(/,/g, '')) <= 0) && postAuditColumnIndex !== -1) {
            console.log(`[Avg Bill Value] CWI empty, trying Post Audit column ${postAuditColumnIndex}`);
            amountCell = row[postAuditColumnIndex];
        }
        
        if (amountCell) {
            const cleanValue = amountCell.toString()
                .replace(/,/g, '')
                .replace(/₹/g, '')
                .replace(/Rs\.?/gi, '')
                .trim();
            
            const numValue = parseFloat(cleanValue);
            
            if (!isNaN(numValue) && numValue > 10000) {
                totalAmount = numValue;
                console.log(`[Avg Bill Value] ✅ Extracted TOTAL: ₹${totalAmount}`);
                break;
            }
        }
    }
}

// If TOTAL not found, manually sum column D (CWI amounts) for all data rows
if (!totalAmount) {
    console.log(`[Avg Bill Value] No TOTAL row found in ${file.fileName}, attempting manual sum...`);
    
    // Find header row first
    let headerRowIdx = -1;
    for (let i = 0; i < Math.min(15, rawData.length); i++) {
        const rowStr = (rawData[i] || []).join(' ').toLowerCase();
        if (rowStr.includes('particulars') || rowStr.includes('as per wo') || rowStr.includes('as per cwi')) {
            headerRowIdx = i;
            break;
        }
    }
    
    if (headerRowIdx !== -1) {
        let manualSum = 0;
        let rowsAdded = 0;
        
        // Find which column index is CWI amount by scanning header
        let cwiColIndex = 3; // default column D
        const headerRow = rawData[headerRowIdx] || [];
        for (let c = 0; c < headerRow.length; c++) {
            const cellStr = (headerRow[c] || '').toString().toLowerCase();
            if (cellStr.includes('cwi') && (cellStr.includes('amount') || cellStr.includes('amt'))) {
                cwiColIndex = c;
                break;
            }
        }
        
        for (let i = headerRowIdx + 1; i < rawData.length; i++) {
            const row = rawData[i];
            const colB = (row[1] || '').toString().trim().toLowerCase();
            
            // Skip empty rows and total/subtotal rows
            if (!colB || colB.includes('total') || colB.includes('grand')) continue;
            
            const cellVal = (row[cwiColIndex] || '').toString()
                .replace(/,/g, '').replace(/₹/g, '').replace(/Rs\.?/gi, '').trim();
            const numVal = parseFloat(cellVal);
            
            if (!isNaN(numVal) && numVal > 0) {
                manualSum += numVal;
                rowsAdded++;
            }
        }
        
        if (manualSum > 10000 && rowsAdded > 0) {
            totalAmount = manualSum;
            console.log(`[Avg Bill Value] ✅ Manual sum of ${rowsAdded} rows = ₹${totalAmount}`);
        }
    }
}

if (!totalAmount) {
    console.log(`[Avg Bill Value] Could not extract total from ${file.fileName}, skipping`);
    continue;
}
                
                console.log(`[Avg Bill Value] ✅ Successfully extracted TOTAL: ₹${totalAmount}`);

// DEDUP: For same area, keep only one entry (the first one found)
if (seenAreas.has(area)) {
    console.log(`[Avg Bill Value] ⚠️ Duplicate area ${area} sqft - skipping ${file.fileName}`);
    continue;
}

seenAreas.set(area, true);
billValues.push(totalAmount);
results.push({
    fileName: file.fileName.replace('.xlsx', ''),
    area: area,
    totalAmount: totalAmount
});
filesProcessed++;
                
            } catch (error) {
                console.error(`[Avg Bill Value] Error processing ${file.fileName}:`, error.message);
            }
        }
        // Sort results by area ascending
results.sort((a, b) => a.area - b.area);
        if (results.length === 0) {
            return res.json({
                answer: `No ICICI branches found in the area range ${areaFilter.min}-${areaFilter.max} sqft.\n\nProcessed ${filesToAnalyze.length} files but none matched the criteria.`,
                sheetsAnalyzed: filesProcessed
            });
        }
        
        const avgBillValue = billValues.reduce((a, b) => a + b, 0) / billValues.length;
        const minBillValue = Math.min(...billValues);
        const maxBillValue = Math.max(...billValues);
        
        const ExcelJS = require('exceljs');
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Avg Bill Value - ICICI');
        
        worksheet.addRow(['File Name', 'Area (sqft)', 'Total Bill Value (₹)']);
        
        worksheet.getRow(1).font = { bold: true };
        worksheet.getRow(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF4472C4' }
        };
        
        results.forEach(result => {
            worksheet.addRow([
                result.fileName,
                result.area,
                result.totalAmount
            ]);
        });
        
        worksheet.addRow([]);
        const summaryRow = worksheet.addRow(['AVERAGE BILL VALUE', '', avgBillValue.toFixed(2)]);
        summaryRow.font = { bold: true, size: 12 };
        summaryRow.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFFFFF00' }
        };
        
        worksheet.addRow(['MINIMUM BILL VALUE', '', minBillValue.toFixed(2)]);
        worksheet.addRow(['MAXIMUM BILL VALUE', '', maxBillValue.toFixed(2)]);
        
        worksheet.columns.forEach(column => {
            column.width = 25;
        });
        
        const buffer = await workbook.xlsx.writeBuffer();
        const base64Excel = buffer.toString('base64');
        
        let answer = `📊 **Average Bill Value Analysis - ICICI Bank**\n\n`;
        answer += `**Area Range:** ${areaFilter.min}-${areaFilter.max} sqft\n`;
        answer += `**Branches Analyzed:** ${results.length}\n`;
        answer += `**Locations:** ${locations.join(', ')}\n\n`;
        
        answer += `### 📈 **Key Metrics:**\n\n`;
        answer += `🎯 **Average TOTAL Bill Value:** ₹${avgBillValue.toLocaleString('en-IN', {minimumFractionDigits: 2})}\n`;
        answer += `📉 **Minimum Bill Value:** ₹${minBillValue.toLocaleString('en-IN', {minimumFractionDigits: 2})}\n`;
        answer += `📈 **Maximum Bill Value:** ₹${maxBillValue.toLocaleString('en-IN', {minimumFractionDigits: 2})}\n\n`;
        
        answer += `### 📋 **Branch-wise Details:**\n\n`;
        results.forEach((result, idx) => {
            answer += `**${idx + 1}. ${result.fileName}**\n`;
            answer += `   • Area: ${result.area} sqft\n`;
            answer += `   • Total Bill Value: ₹${result.totalAmount.toLocaleString('en-IN', {minimumFractionDigits: 2})}\n\n`;
        });
        
        answer += `\n📥 **Detailed Excel report ready for download!**`;
        
        const responseData = {
    answer: answer,
    sheetsAnalyzed: results.length,
    totalFilesProcessed: filesToAnalyze.length,
    avgBillValue: avgBillValue.toFixed(2),
    minBillValue: minBillValue.toFixed(2),
    maxBillValue: maxBillValue.toFixed(2),
    excelReport: base64Excel,
    excelFileName: `Avg_Bill_Value_ICICI_${areaFilter.min}_${areaFilter.max}_sqft_${new Date().toISOString().split('T')[0]}.xlsx`
};

// Save to Firestore query cache
try {
    const queryCacheId = `avg_bill_value_ICICI_${areaFilter.min}_${areaFilter.max}_${locations.sort().join('_')}`;
    await setDoc(doc(db, 'analyticsQueryCache', queryCacheId), {
        ...responseData,
        cachedAt: Date.now(),
        question: question,
        banks: banks,
        locations: locations
    });
    console.log(`[Avg Bill Value] ✅ Saved to Firestore query cache: ${queryCacheId}`);
} catch (cacheErr) {
    console.error('[Avg Bill Value] Cache save failed:', cacheErr.message);
}

res.json(responseData);
        
    } catch (error) {
        console.error('[Avg Bill Value] Error:', error);
        res.status(500).json({ 
            error: 'Failed to process avg bill value analysis: ' + error.message
        });
    }
});
/* =================================================================
 * TOP 5 REPEATED CONTRACTORS - ICICI
 * ================================================================= */
app.post('/api/analytics/top-contractors', authenticateAdmin, verifyPasswordNotChanged, async (req, res) => {
    try {
        const { banks, locations } = req.body;
        
        // Check Firestore cache first
        const cacheId = `top_contractors_ICICI_${locations.sort().join('_')}`;
        try {
            const cacheSnap = await getDoc(doc(db, 'analyticsQueryCache', cacheId));
            if (cacheSnap.exists() && cacheSnap.data().answer) {
                console.log('[Top Contractors] Cache HIT');
                return res.json(cacheSnap.data());
            }
        } catch (e) { console.log('[Top Contractors] Cache miss'); }
        
        const filesToAnalyze = await listFilesFromStorage(banks, locations);
        
        if (filesToAnalyze.length === 0) {
            return res.json({ answer: "No files found.", sheetsAnalyzed: 0 });
        }

        const contractorMap = {}; // contractorName -> { totalCWI, branches: [] }
        let filesProcessed = 0;

        for (const file of filesToAnalyze) {
            try {
                const response = await axios.get(file.downloadURL, { 
                    responseType: 'arraybuffer', timeout: 30000 
                });
                const workbook = XLSX.read(response.data, { type: 'array' });
                
                // Find summary sheet
                let summarySheet = null;
                let summarySheetName = null;
                for (const sheetName of workbook.SheetNames) {
                    const lower = sheetName.toLowerCase();
                    if (lower.includes('cwi summary') || lower.includes('summary')) {
                        summarySheet = workbook.Sheets[sheetName];
                        summarySheetName = sheetName;
                        break;
                    }
                }
                
                if (!summarySheet) continue;
                
                const rawData = XLSX.utils.sheet_to_json(summarySheet, { 
                    header: 1, defval: '', raw: false 
                });
                
                // Find contractor/vendor name - look in first 10 rows for "Contractor" or "Vendor" label
let contractorName = null;
for (let i = 0; i < Math.min(10, rawData.length); i++) {
    const row = rawData[i];
    for (let c = 0; c < row.length; c++) {
        const cellStr = (row[c] || '').toString().toLowerCase().trim();
        const isContractorLabel = cellStr.includes('contractor') || 
                                  cellStr.includes('vendor');
        if (isContractorLabel) {
            // Name could be in next cell or the cell after
            const candidate1 = (row[c + 1] || '').toString().trim();
            const candidate2 = (row[c + 2] || '').toString().trim();
            contractorName = candidate1.length > 2 ? candidate1 : candidate2;
            if (contractorName && contractorName.length > 2) break;
        }
    }
    if (contractorName) break;
}
                
                const invalidNames = ['as per contractor', 'post-audit', 'post audit', 'cwi', 'as per cwi', 'amount', 'contractor (post-audit)', 'as per contractor (post-audit)', 'as per vendor', 'vendor name', 'contractor name'];
if (!contractorName || contractorName.length < 2 || invalidNames.some(bad => contractorName.toLowerCase().includes(bad))) {
                    console.log(`[Top Contractors] No contractor found in ${file.fileName}`);
                    continue;
                }
                
                // Find TOTAL row and CWI amount
                let totalCWI = null;
                
                // First find CWI column index from headers
                let cwiColIndex = 3;
                for (let i = 0; i < Math.min(15, rawData.length); i++) {
                    const row = rawData[i] || [];
                    const rowStr = row.join(' ').toLowerCase();
                    if (rowStr.includes('as per cwi') || rowStr.includes('amount of cwi')) {
                        for (let c = 0; c < row.length; c++) {
                            const cellStr = (row[c] || '').toString().toLowerCase();
                            if ((cellStr.includes('cwi') || cellStr.includes('amount of cwi')) && 
                                (cellStr.includes('amount') || cellStr.includes('amt'))) {
                                cwiColIndex = c;
                                break;
                            }
                        }
                        break;
                    }
                }
                
                // Find TOTAL row
                for (let i = 0; i < rawData.length; i++) {
                    const row = rawData[i];
                    const col0 = (row[0] || '').toString().trim().toLowerCase();
                    const col1 = (row[1] || '').toString().trim().toLowerCase();
                    
                    if (col1 === 'total' || col0 === 'total' ||
                        (col1.includes('total') && !col1.includes('grand') && !col1.includes('sub') && !col1.includes('tax'))) {
                        
                        const amountCell = row[cwiColIndex];
                        if (amountCell) {
                            const cleanVal = amountCell.toString()
                                .replace(/,/g, '').replace(/₹/g, '').replace(/Rs\.?/gi, '').trim();
                            const numVal = parseFloat(cleanVal);
                            if (!isNaN(numVal) && numVal > 1000) {
                                totalCWI = numVal;
                                break;
                            }
                        }
                    }
                }
                
                if (!totalCWI) continue;
                
                // Normalize contractor name (trim and lowercase for grouping)
                const normalizedName = contractorName.trim();
                
                if (!contractorMap[normalizedName]) {
                    contractorMap[normalizedName] = {
                        name: normalizedName,
                        totalCWI: 0,
                        branchCount: 0,
                        branches: []
                    };
                }
                
                contractorMap[normalizedName].totalCWI += totalCWI;
                contractorMap[normalizedName].branchCount += 1;
                contractorMap[normalizedName].branches.push({
                    branch: file.fileName.replace('.xlsx', ''),
                    location: file.location,
                    cwi: totalCWI
                });
                
                filesProcessed++;
                
            } catch (err) {
                console.error(`[Top Contractors] Error in ${file.fileName}:`, err.message);
            }
        }
        
        // Sort by number of branches (most repeated), then by total CWI
        const sorted = Object.values(contractorMap)
            .filter(c => c.branchCount > 1) // Only repeated contractors
            .sort((a, b) => b.branchCount - a.branchCount || b.totalCWI - a.totalCWI)
            .slice(0, 5);
        
        if (sorted.length === 0) {
            return res.json({
                answer: `No repeated contractors found across ${filesProcessed} branches analyzed.`,
                sheetsAnalyzed: filesProcessed
            });
        }
        
        // Build Excel
        const ExcelJS = require('exceljs');
        const workbook = new ExcelJS.Workbook();
        const ws = workbook.addWorksheet('Top 5 Contractors');
        
        ws.addRow(['Rank', 'Contractor Name', 'No. of Branches', 'Total CWI Amount (₹)', 'Locations', 'Branch Details']);
        ws.getRow(1).font = { bold: true };
        ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
        
        sorted.forEach((contractor, idx) => {
            const branchDetails = contractor.branches
                .map(b => `${b.branch} (₹${b.cwi.toLocaleString('en-IN')})`)
                .join(' | ');
            const locations = [...new Set(contractor.branches.map(b => b.location))].join(', ');
            
            ws.addRow([
                idx + 1,
                contractor.name,
                contractor.branchCount,
                contractor.totalCWI,
                locations,
                branchDetails
            ]);
        });
        
        ws.columns.forEach(col => { col.width = 25; });
        
        const buffer = await workbook.xlsx.writeBuffer();
        const base64Excel = buffer.toString('base64');
        
        let answer = `🏗️ **Top 5 Most Repeated Contractors - ICICI Bank**\n\n`;
        answer += `**Locations Analyzed:** ${locations.join(', ')}\n`;
        answer += `**Files Processed:** ${filesProcessed}\n\n`;
        
        sorted.forEach((contractor, idx) => {
            const locationsList = [...new Set(contractor.branches.map(b => b.location))].join(', ');
            answer += `**${idx + 1}. ${contractor.name}**\n`;
            answer += `   • Branches Handled: ${contractor.branchCount}\n`;
            answer += `   • Total CWI Amount: ₹${contractor.totalCWI.toLocaleString('en-IN', { minimumFractionDigits: 2 })}\n`;
            answer += `   • Zones Active: ${locationsList}\n\n`;
        });
        
        const responseData = {
            answer,
            sheetsAnalyzed: filesProcessed,
            excelReport: base64Excel,
            excelFileName: `Top5_Contractors_ICICI_${new Date().toISOString().split('T')[0]}.xlsx`
        };
        
        // Save to Firestore cache
        try {
            await setDoc(doc(db, 'analyticsQueryCache', cacheId), {
                ...responseData, cachedAt: Date.now()
            });
        } catch (e) { console.log('[Top Contractors] Cache save failed'); }
        
        res.json(responseData);
        
    } catch (error) {
        console.error('[Top Contractors] Error:', error);
        res.status(500).json({ error: 'Failed to process: ' + error.message });
    }
});

/* =================================================================
 * IDEAL BRANCH AREA ZONE WISE - ICICI
 * ================================================================= */
app.post('/api/analytics/ideal-area', authenticateAdmin, verifyPasswordNotChanged, async (req, res) => {
    try {
        const { banks, locations } = req.body;
        
        const cacheId = `ideal_area_ICICI_${locations.sort().join('_')}`;
        try {
            const cacheSnap = await getDoc(doc(db, 'analyticsQueryCache', cacheId));
            if (cacheSnap.exists() && cacheSnap.data().answer) {
                console.log('[Ideal Area] Cache HIT');
                return res.json(cacheSnap.data());
            }
        } catch (e) { console.log('[Ideal Area] Cache miss'); }
        
        const filesToAnalyze = await listFilesFromStorage(banks, locations);
        
        if (filesToAnalyze.length === 0) {
            return res.json({ answer: "No files found.", sheetsAnalyzed: 0 });
        }

        // Zone -> area bucket -> count
        const zoneAreaMap = {};
        
        const areaBuckets = [
            { label: 'Below 1000 sqft', min: 0, max: 999 },
            { label: '1000-1250 sqft', min: 1000, max: 1250 },
            { label: '1251-1500 sqft', min: 1251, max: 1500 },
            { label: '1501-1750 sqft', min: 1501, max: 1750 },
            { label: '1751-2000 sqft', min: 1751, max: 2000 },
            { label: '2001-2500 sqft', min: 2001, max: 2500 },
            { label: '2501-3000 sqft', min: 2501, max: 3000 },
            { label: 'Above 3000 sqft', min: 3001, max: Infinity }
        ];
        
        let filesProcessed = 0;
        
        for (const file of filesToAnalyze) {
            // Extract area from filename
            const match = file.fileName.match(/^\d+_(\d{3,5})[Ss]q[Ff]t?/i) ||
                          file.fileName.match(/_(\d{3,5})[Ss]q[Ff]t?/i) ||
                          file.fileName.match(/(\d{3,5})[Ss]q[Ff]t?/i);
            
            if (!match) continue;
            
            const area = parseInt(match[1]);
            if (!area || area < 100) continue;
            
            const zone = file.location; // East, West, North, South
            
            if (!zoneAreaMap[zone]) {
                zoneAreaMap[zone] = {};
                areaBuckets.forEach(b => { zoneAreaMap[zone][b.label] = 0; });
            }
            
            const bucket = areaBuckets.find(b => area >= b.min && area <= b.max);
            if (bucket) {
                zoneAreaMap[zone][bucket.label]++;
                filesProcessed++;
            }
        }
        
        // Build Excel
        const ExcelJS = require('exceljs');
        const workbook = new ExcelJS.Workbook();
        const ws = workbook.addWorksheet('Ideal Area Zone Wise');
        
        const headerRow = ['Area Range', ...locations];
        ws.addRow(headerRow);
        ws.getRow(1).font = { bold: true };
        ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
        
        areaBuckets.forEach(bucket => {
            const row = [bucket.label];
            locations.forEach(zone => {
                row.push(zoneAreaMap[zone] ? (zoneAreaMap[zone][bucket.label] || 0) : 0);
            });
            ws.addRow(row);
        });
        
        ws.columns.forEach(col => { col.width = 20; });
        
        const buffer = await workbook.xlsx.writeBuffer();
        const base64Excel = buffer.toString('base64');
        
        let answer = `🏢 **Ideal Branch Area for ICICI Bank - Zone Wise Analysis**\n\n`;
        answer += `**Total Branches Analyzed:** ${filesProcessed}\n\n`;
        
        locations.forEach(zone => {
            if (!zoneAreaMap[zone]) return;
            
            answer += `### 📍 **${zone} Zone:**\n`;
            
            const sortedBuckets = areaBuckets
                .map(b => ({ label: b.label, count: zoneAreaMap[zone][b.label] || 0 }))
                .sort((a, b) => b.count - a.count);
            
            const topBucket = sortedBuckets[0];
            answer += `   🏆 **Most Common Area:** ${topBucket.label} (${topBucket.count} branches)\n`;
            
            sortedBuckets.filter(b => b.count > 0).forEach(b => {
                answer += `   • ${b.label}: ${b.count} branch${b.count > 1 ? 'es' : ''}\n`;
            });
            answer += `\n`;
        });
        
        answer += `\n**Insight:** The most frequently chosen area range indicates the ideal operational space ICICI Bank targets for customer-facing branches.`;
        
        const responseData = {
            answer,
            sheetsAnalyzed: filesProcessed,
            excelReport: base64Excel,
            excelFileName: `Ideal_Area_ZoneWise_ICICI_${new Date().toISOString().split('T')[0]}.xlsx`
        };
        
        try {
            await setDoc(doc(db, 'analyticsQueryCache', cacheId), {
                ...responseData, cachedAt: Date.now()
            });
        } catch (e) { console.log('[Ideal Area] Cache save failed'); }
        
        res.json(responseData);
        
    } catch (error) {
        console.error('[Ideal Area] Error:', error);
        res.status(500).json({ error: 'Failed to process: ' + error.message });
    }
});

/* =================================================================
 * BRANCH SAVINGS ANALYSIS - ICICI
 * ================================================================= */
app.post('/api/analytics/branch-savings', authenticateAdmin, verifyPasswordNotChanged, async (req, res) => {
    try {
        const { banks, locations } = req.body;
        
        const cacheId = `branch_savings_ICICI_${locations.sort().join('_')}`;
        try {
            const cacheSnap = await getDoc(doc(db, 'analyticsQueryCache', cacheId));
            if (cacheSnap.exists() && cacheSnap.data().answer) {
                console.log('[Branch Savings] Cache HIT');
                return res.json(cacheSnap.data());
            }
        } catch (e) { console.log('[Branch Savings] Cache miss'); }
        
        const filesToAnalyze = await listFilesFromStorage(banks, locations);
        
        if (filesToAnalyze.length === 0) {
            return res.json({ answer: "No files found.", sheetsAnalyzed: 0 });
        }

        const branchResults = [];
        let filesProcessed = 0;

        for (const file of filesToAnalyze) {
            try {
                const response = await axios.get(file.downloadURL, { 
                    responseType: 'arraybuffer', timeout: 30000 
                });
                const workbook = XLSX.read(response.data, { type: 'array' });
                
                // Find summary sheet
                let summarySheet = null;
                for (const sheetName of workbook.SheetNames) {
                    const lower = sheetName.toLowerCase();
                    if (lower.includes('cwi summary') || lower.includes('summary')) {
                        summarySheet = workbook.Sheets[sheetName];
                        break;
                    }
                }
                
                if (!summarySheet) continue;
                
                const rawData = XLSX.utils.sheet_to_json(summarySheet, { 
                    header: 1, defval: '', raw: false 
                });
                
                // Find Saving and Total columns from header row
                let savingColIndex = -1;
                let totalColIndex = -1;
                let headerRowIdx = -1;
                
                for (let i = 0; i < Math.min(15, rawData.length); i++) {
                    const row = rawData[i] || [];
                    const rowStr = row.join(' ').toLowerCase();
                    if (rowStr.includes('saving') || rowStr.includes('excess')) {
                        headerRowIdx = i;
                        for (let c = 0; c < row.length; c++) {
                            const cellStr = (row[c] || '').toString().toLowerCase();
                            if (cellStr === 'saving' || cellStr === 'savings') savingColIndex = c;
                            if (cellStr === 'total') totalColIndex = c;
                        }
                        break;
                    }
                }
                
                if (savingColIndex === -1) continue;
                
                // Find TOTAL row
                let totalRowSaving = null;
                let totalRowTotal = null;
                
                for (let i = 0; i < rawData.length; i++) {
                    const row = rawData[i];
                    const col0 = (row[0] || '').toString().trim().toLowerCase();
                    const col1 = (row[1] || '').toString().trim().toLowerCase();
                    
                    if (col1 === 'total' || col0 === 'total' ||
                        (col1.includes('total') && !col1.includes('grand') && !col1.includes('sub') && !col1.includes('tax'))) {
                        
                        if (savingColIndex !== -1 && row[savingColIndex]) {
                            const cleanSaving = row[savingColIndex].toString()
                                .replace(/,/g, '').replace(/₹/g, '').replace(/-/g, '').trim();
                            const numSaving = parseFloat(cleanSaving);
                            if (!isNaN(numSaving)) totalRowSaving = numSaving;
                        }
                        
                        if (totalColIndex !== -1 && row[totalColIndex]) {
                            const cleanTotal = row[totalColIndex].toString()
                                .replace(/,/g, '').replace(/₹/g, '').replace(/-/g, '').trim();
                            const numTotal = parseFloat(cleanTotal);
                            if (!isNaN(numTotal)) totalRowTotal = numTotal;
                        }
                        
                        break;
                    }
                }
                
                if (totalRowSaving === null && totalRowTotal === null) continue;
                
                // Extract branch name from filename
                const branchName = file.fileName
                    .replace('.xlsx', '')
                    .replace(/^\d+_/, '')
                    .replace(/\d{3,5}[Ss]q[Ff]t?_?/i, '')
                    .replace(/ICICI_BANK_?/i, '')
                    .replace(/_/g, ' ')
                    .trim();
                
                branchResults.push({
                    fileName: file.fileName.replace('.xlsx', ''),
                    branchName: branchName,
                    location: file.location,
                    savings: totalRowSaving || 0,
                    netTotal: totalRowTotal || 0
                });
                
                filesProcessed++;
                
            } catch (err) {
                console.error(`[Branch Savings] Error in ${file.fileName}:`, err.message);
            }
        }
        
        if (branchResults.length === 0) {
            return res.json({
                answer: `No savings data found across files analyzed.`,
                sheetsAnalyzed: filesProcessed
            });
        }
        
        // Sort by savings descending
        branchResults.sort((a, b) => b.savings - a.savings);
        
        // Build Excel
        const ExcelJS = require('exceljs');
        const workbook = new ExcelJS.Workbook();
        const ws = workbook.addWorksheet('Branch Savings');
        
        ws.addRow(['Branch Name', 'Zone', 'Savings Achieved (₹)', 'Net Total (₹)', 'Full File Name']);
        ws.getRow(1).font = { bold: true };
        ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
        
        branchResults.forEach(b => {
            ws.addRow([
                b.branchName,
                b.location,
                b.savings,
                b.netTotal,
                b.fileName
            ]);
        });
        
        ws.addRow([]);
        const totalSavings = branchResults.reduce((sum, b) => sum + b.savings, 0);
        const totalRow = ws.addRow(['TOTAL SAVINGS ACROSS ALL BRANCHES', '', totalSavings, '', '']);
        totalRow.font = { bold: true };
        totalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
        
        ws.columns.forEach(col => { col.width = 30; });
        
        const buffer = await workbook.xlsx.writeBuffer();
        const base64Excel = buffer.toString('base64');
        
        let answer = `💰 **Branch-wise Savings Analysis - ICICI Bank**\n\n`;
        answer += `**Branches Analyzed:** ${branchResults.length}\n`;
        answer += `**Total Savings Across All Branches:** ₹${totalSavings.toLocaleString('en-IN', { minimumFractionDigits: 2 })}\n\n`;
        
        // Group by zone
        locations.forEach(zone => {
            const zoneBranches = branchResults.filter(b => b.location === zone);
            if (zoneBranches.length === 0) return;
            
            const zoneSavings = zoneBranches.reduce((sum, b) => sum + b.savings, 0);
            
            answer += `### 📍 **${zone} Zone** (Total Net Total: ₹${zoneSavings.toLocaleString('en-IN', { minimumFractionDigits: 2 })})\n`;
            
            zoneBranches.slice(0, 5).forEach((b, idx) => {
                answer += `   ${idx + 1}. **${b.branchName}** — Net Total: ₹${b.netTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}\n`;
            });
            if (zoneBranches.length > 5) {
                answer += `   _(and ${zoneBranches.length - 5} more branches — see Excel for full list)_\n`;
            }
            answer += `\n`;
        });
        
        const responseData = {
            answer,
            sheetsAnalyzed: filesProcessed,
            excelReport: base64Excel,
            excelFileName: `Branch_Savings_ICICI_${new Date().toISOString().split('T')[0]}.xlsx`
        };
        
        try {
            await setDoc(doc(db, 'analyticsQueryCache', cacheId), {
                ...responseData, cachedAt: Date.now()
            });
        } catch (e) { console.log('[Branch Savings] Cache save failed'); }
        
        res.json(responseData);
        
    } catch (error) {
        console.error('[Branch Savings] Error:', error);
        res.status(500).json({ error: 'Failed to process: ' + error.message });
    }
});
app.post('/api/analytics/save-conversation', authenticateAdmin, verifyPasswordNotChanged, async (req, res) => {
    try {
        const { conversationId, messages, banks, locations } = req.body;
        
        const conversationData = {
            conversationId: conversationId,
            messages: messages,
            banks: banks,
            locations: locations,
            timestamp: new Date().toISOString(),
            userName: req.user.name || 'Admin'
        };
        
        await setDoc(doc(db, 'analyticsConversations', conversationId), conversationData);
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error saving conversation:', error);
        res.status(500).json({ error: 'Failed to save conversation' });
    }
});

/* =================================================================
 * USER AUTH & STATS ROUTES
 * ================================================================= */
app.get('/api/health', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development'
    });
});

app.post('/api/register', async (req, res) => {
    try {
        const { name, email, password, location } = req.body;
        const usersRef = collection(db, 'users');
        const q = query(usersRef, where('email', '==', email));
        const userSnapshot = await getDocs(q);

        if (!userSnapshot.empty) {
            return res.status(400).json({ error: 'Email already registered' });
        }
        
        const hashedPassword = await bcrypt.hash(password, 8);
        const passwordChangedAt = Date.now();
        
        // ✅ NEW: Auto-approve user on signup (approved: true)
        await addDoc(usersRef, { 
            name, 
            email, 
            password: hashedPassword, 
            location: location || 'Not provided', 
            approved: false,  // Requires admin approval
            passwordChangedAt: passwordChangedAt,
            createdAt: new Date().toISOString()
        });
        
        

        const approveLink = `${req.protocol}://${req.get('host')}/api/approve-user?email=${encodeURIComponent(email)}`;

await sendApprovalEmail(name, email, location, approveLink)
    .catch(err => console.log('Approval email failed:', err.message));
        
        // ✅ NEW: Return success message allowing immediate login
        res.status(201).json({ 
    message: 'Registration successful! Please wait for admin approval before logging in.',
    canLogin: false
});
    } catch (error) {
        console.error("Register Error:", error);
        res.status(500).json({ error: 'Server error during registration' });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (email === 'admin@admin.com' && password === 'Raacushwake@10cr') {
    // ✅ Get admin password change timestamp
    const adminRef = doc(db, 'adminConfig', 'credentials');
    const adminDoc = await getDoc(adminRef);
    
    let passwordChangedAt = null;
    if (adminDoc.exists()) {
        passwordChangedAt = adminDoc.data().passwordChangedAt || Date.now();
    } else {
        passwordChangedAt = Date.now();
        await setDoc(adminRef, { passwordChangedAt });
    }

    const adminToken = jwt.sign({
        email: 'admin@admin.com',
        name: 'Admin',
        role: 'admin',
        passwordChangedAt: passwordChangedAt  // ✅ ADDED
    }, JWT_SECRET, { expiresIn: '1d' });
    
    return res.json({ token: adminToken, name: 'Admin' });
}

        const usersRef = collection(db, 'users');
        const q = query(usersRef, where('email', '==', email));
        const userSnapshot = await getDocs(q);
        if (userSnapshot.empty) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        const userDoc = userSnapshot.docs[0];
        const user = userDoc.data();
        
        if (!user.approved) {
            return res.status(403).json({ error: 'Your account is pending admin approval. Please wait.' });
        }
        
        
       // ✅ Get password change timestamp
const passwordChangedAt = user.passwordChangedAt || Date.now();

const token = jwt.sign({
    email: user.email,
    name: user.name,
    id: userDoc.id,
    role: 'user',
    passwordChangedAt: passwordChangedAt  // ✅ ADDED
}, JWT_SECRET, { expiresIn: '1d' });
        
        res.json({ token, name: user.name });
    } catch (error) {
        console.error("Login Error:", error);
        res.status(500).json({ error: 'Server error during login' });
    }
});
// ✅ NEW: Session validation endpoint
app.get('/api/check-session', authenticateToken, verifyPasswordNotChanged, async (req, res) => {
    res.json({ 
        valid: true,
        user: {
            email: req.user.email,
            name: req.user.name,
            role: req.user.role
        }
    });
});

app.get('/api/verify-user-exists', authenticateToken, async (req, res) => {
    try {
        if (req.user.role === 'admin') {
            return res.json({ exists: true });
        }
        
        const usersRef = collection(db, 'users');
        const q = query(usersRef, where('email', '==', req.user.email));
        const userSnapshot = await getDocs(q);
        
        if (userSnapshot.empty) {
            return res.json({ exists: false, forceLogout: true });
        }
        
        res.json({ exists: true });
    } catch (error) {
        console.error('[USER VERIFY] Error:', error);
        res.status(500).json({ error: 'Verification failed' });
    }
});
// ✅ NEW: Change password route
app.post("/api/change-password", authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "Current and new passwords required" });
    }

    if (req.user.role === "admin") {
      // Admin password change
      if (currentPassword !== "Raacushwake20cr") {
        return res.status(401).json({ error: "Current password incorrect" });
      }

      const adminRef = doc(db, "adminConfig", "credentials");
      await setDoc(adminRef, {
        passwordChangedAt: Date.now(), // CRITICAL: Update timestamp
        newPasswordHash: await bcrypt.hash(newPassword, 10),
        updatedAt: new Date().toISOString()
      }, { merge: true });

      console.log("PASSWORD CHANGE: Admin password updated");
      return res.json({ 
        success: true, 
        message: "Password changed. All sessions invalidated." 
      });
    } else {
      // Regular user password change
      const usersRef = collection(db, "users");
      const q = query(usersRef, where("email", "==", req.user.email));
      const userSnapshot = await getDocs(q);
      
      if (userSnapshot.empty) {
        return res.status(404).json({ error: "User not found" });
      }

      const userDoc = userSnapshot.docs[0];
      const user = userDoc.data();
      
      const validPassword = await bcrypt.compare(currentPassword, user.password);
      if (!validPassword) {
        return res.status(401).json({ error: "Current password incorrect" });
      }

      const hashedNewPassword = await bcrypt.hash(newPassword, 10);
      
      await updateDoc(userDoc.ref, {
        password: hashedNewPassword,
        passwordChangedAt: Date.now(), // CRITICAL: Update timestamp
        updatedAt: new Date().toISOString()
      });

      console.log(`PASSWORD CHANGE: User ${req.user.email} password changed`);
      return res.json({ 
        success: true, 
        message: "Password changed. Please login again." 
      });
    }
  } catch (error) {
    console.error("Change password error:", error);
    res.status(500).json({ error: "Failed to change password" });
  }
});

app.get('/api/approve-user', async (req, res) => {
    const { email } = req.query;
    try {
        if (!email) {
            return res.status(400).send('<h1>Email query parameter is missing.</h1>');
        }
        const userQuery = query(collection(db, 'users'), where('email', '==', email));
        const userSnapshot = await getDocs(userQuery);
        if (!userSnapshot.empty) {
            await updateDoc(userSnapshot.docs[0].ref, { approved: true });
            res.send('<h1>User approved successfully!</h1><p>You can close this window.</p>');
        } else {
            res.status(404).send('<h1>User not found!</h1>');
        }
    } catch (error) {
        console.error('Error approving user:', error);
        res.status(500).send('<h1>Error approving user! Please check server logs.</h1>');
    }
});

app.get('/api/stats/boq-count', authenticateToken, verifyPasswordNotChanged, async (req, res) => {
    try {
        const statsDocRef = doc(db, 'dashboard_stats', 'live_counts');
        const docSnap = await getDoc(statsDocRef);

        if (docSnap.exists()) {
            res.json({ count: docSnap.data().boqProcessedCount });
        } else {
            await setDoc(statsDocRef, { boqProcessedCount: 213 });
            res.json({ count: 213 });
        }
    } catch (error) {
        console.error("Error fetching BOQ count:", error);
        res.status(500).json({ error: 'Could not fetch count' });
    }
});

app.post('/api/stats/increment-boq-count', authenticateToken, verifyPasswordNotChanged, async (req, res) => {
    try {
        const statsDocRef = doc(db, 'dashboard_stats', 'live_counts');
        await updateDoc(statsDocRef, {
            boqProcessedCount: increment(1)
        });
        res.json({ success: true, message: 'Count incremented.' });
    } catch (error) {
        console.error("Error incrementing BOQ count:", error);
        res.status(500).json({ error: 'Could not increment count' });
    }
});

/* =================================================================
 * LIVE CHAT & TELEGRAM BOT ROUTES
 * ================================================================= */
app.post('/api/chat/navigate', (req, res) => {
    const { nodeId } = req.body;
    const node = chatFlow[nodeId] || chatFlow['root'];
    res.json(node);
});

app.post('/api/chat/create-session', async (req, res) => {
    try {
        const { issue, userName } = req.body;
        if (!issue) return res.status(400).json({ error: "Issue category is required." });

        const newChat = {
            type: 'Live Chat Session',
            userName: userName || "Website User",
            issue: issue,
            createdAt: new Date().toISOString(),
            replies: [{
                from: 'Assistant',
                type: 'text',
                content: `An agent has been notified about your issue with: **${issue}**. They will be with you shortly. Please describe your problem in detail.`,
                timestamp: new Date().toISOString()
            }]
        };
        const docRef = await addDoc(collection(db, "sharedFiles"), newChat);
        const adminMessage = `🚨 *New Chat Request*\n*User:* ${userName || "Website User"}\n*Issue:* ${issue}\n\n*Reply with:* \`/reply ${docRef.id} YOUR MESSAGE HERE\``;
        await bot.sendMessage(GROUP_CHAT_ID, adminMessage, { parse_mode: 'Markdown' });
        res.status(201).json({ chatSessionId: docRef.id });
    } catch (error) {
        console.error("Chat Create Session Error:", error);
        res.status(500).json({ error: "Could not create chat session." });
    }
});

app.get('/api/chat/messages/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const docRef = doc(db, 'sharedFiles', sessionId);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            res.json({ replies: docSnap.data().replies || [] });
        } else {
            res.status(404).json({ error: 'Chat session not found.' });
        }
    } catch (error) {
        console.error("Fetch Messages Error:", error);
        res.status(500).json({ error: "Could not fetch messages." });
    }
});

app.post('/api/send-telegram-message', async (req, res) => {
    const { content, type, from, chatSessionId } = req.body;
    if (!content || !type || !from || !chatSessionId) {
        return res.status(400).json({ error: 'All fields are required.' });
    }
    
    const userReply = { content, type, from, timestamp: new Date().toISOString() };
    
    try {
        const docRef = doc(db, 'sharedFiles', chatSessionId);
        await updateDoc(docRef, { replies: arrayUnion(userReply) });
        
        if (type === 'image') {
            const captionForAdmin = `🖼️ *New Image from ${from}*\n\n*Reply with:* \`/reply ${chatSessionId} YOUR MESSAGE HERE\``;
            await bot.sendPhoto(GROUP_CHAT_ID, content, { caption: captionForAdmin, parse_mode: 'Markdown' });
        } else {
            const messageForAdmin = `💬 *New Message from ${from}*\n\n*Message:* ${content}\n\n*Reply with:* \`/reply ${chatSessionId} YOUR MESSAGE HERE\``;
            await bot.sendMessage(GROUP_CHAT_ID, messageForAdmin, { parse_mode: 'Markdown' });
        }
        
        res.status(200).json({ success: true });
    } catch (error) {
        console.error('Error sending message:', error);
        res.status(500).json({ error: 'Failed to process message.' });
    }
});

app.post('/api/upload-image', authenticateToken, verifyPasswordNotChanged, async (req, res) => {
    try {
        const { imageData, fileName, chatSessionId } = req.body;
        if (!imageData || !fileName || !chatSessionId) {
            return res.status(400).json({ error: 'Missing required fields' });
        }
        const base64Data = imageData.replace(/^data:image\/\w+;base64,/, '');
        const imageBuffer = Buffer.from(base64Data, 'base64');
        const downloadURL = await uploadImageToFirebase(imageBuffer, fileName, chatSessionId);
        res.json({ success: true, imageUrl: downloadURL });
    } catch (error) {
        console.error('Error in /api/upload-image:', error);
        res.status(500).json({ error: 'Failed to upload image', details: error.message });
    }
});

bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, 'Welcome to the AI Tools Bot! 🤖\n\nReady to receive website messages and handle image uploads.');
});

bot.onText(/\/reply (\S+) (.+)/s, async (msg, match) => {
    const chatId = msg.chat.id;
    const documentId = match[1];      
    const replyText = match[2];    
    const replierName = msg.from.first_name || 'Admin';
    
    try {
        const fileRef = doc(db, 'sharedFiles', documentId);
        const docSnap = await getDoc(fileRef);
        
        if (!docSnap.exists()) {
             bot.sendMessage(chatId, `❌ Error: No chat session found with ID \`${documentId}\`. Please check the ID and try again.`);
             return;
        }

        const newReply = {
            content: replyText,
            type: 'text',
            from: replierName,
            timestamp: new Date().toISOString()
        };
        
        await updateDoc(fileRef, { replies: arrayUnion(newReply) });
        bot.sendMessage(chatId, `✅ Reply sent to website chat!`);
    } catch (error) {
        console.error('Error adding reply to Firestore:', error);
        bot.sendMessage(chatId, '❌ Failed to add reply. A server error occurred.');
    }
});

bot.on('photo', async (msg) => {
    const chatId = msg.chat.id;
    const photo = msg.photo[msg.photo.length - 1];
    const caption = msg.caption || '';
    
    try {
        const replyMatch = caption.match(/\/reply (\S+)/);
        if (!replyMatch) {
            bot.sendMessage(chatId, '💡 To send an image to a chat, you must include `/reply CHAT_ID` in the caption.');
            return;
        }

        bot.sendMessage(chatId, '📷 Processing image reply...');
        const chatSessionId = replyMatch[1];
        
        const fileInfo = await bot.getFile(photo.file_id);
        const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${fileInfo.file_path}`;
        const fileName = `telegram_reply_${photo.file_id}.jpg`;

        const response = await axios.get(fileUrl, { responseType: 'arraybuffer' });
        const imageBuffer = Buffer.from(response.data);
        const firebaseImageUrl = await uploadImageToFirebase(imageBuffer, fileName, chatSessionId);

        const fileRef = doc(db, 'sharedFiles', chatSessionId);
        const docSnap = await getDoc(fileRef);
        if (!docSnap.exists()) {
            bot.sendMessage(chatId, `❌ Error: No chat session found with ID \`${chatSessionId}\`.`);
            return;
        }
        
        const newReply = {
            content: firebaseImageUrl,
            type: 'image',
            from: msg.from.first_name || 'Admin',
            timestamp: new Date().toISOString()
        };
        
        await updateDoc(fileRef, { replies: arrayUnion(newReply) });
        bot.sendMessage(chatId, `✅ Image reply sent to website chat!`);
        
    } catch (error) {
        console.error('Error handling photo reply:', error);
        bot.sendMessage(chatId, '❌ Error processing image reply.');
    }
});

/* =================================================================
 * ERROR HANDLING & SERVER START
 * ================================================================= */
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/analytics-bot.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'analytics-bot.html'));
});

app.get(/^(?!\/api).*/, (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`🚀 Render deployment ready`);
    console.log(`🔧 Admin credentials: admin@admin.com / Raacushwake@10cr`);
});

process.on('SIGTERM', () => {
    console.log('SIGTERM received. Shutting down gracefully...');
    server.close(() => {
        console.log('Process terminated');
    });
});
