const express = require('express');
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = 3000;
const DB_PATH = path.join(__dirname, 'links.json');

let urls = {};

if (fs.existsSync(DB_PATH)) {
    try {
        urls = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    } catch (e) {
        urls = {};
    }
}

let saveTimeout = null;
const bufferedSave = () => {
    if (saveTimeout) return;
    saveTimeout = setTimeout(() => {
        fs.writeFile(DB_PATH, JSON.stringify(urls, null, 2), (err) => {
            if (err) console.error("Disk Write Error:", err);
            saveTimeout = null;
        });
    }, 2000);
};


const rateLimiter = rateLimit({
    windowMs: 20 * 60 * 1000,
    max: 5,
    message: { error: "Way too many attempts. Please try again in one-third of an hour." },
    standardHeaders: true,
    legacyHeaders: false,
    statusCode: 429
});

app.use(express.json());
app.use(express.static('public'));


app.post('/shorten', async (req, res) => {
    const { longUrl, pin } = req.body;

    const xyzRegex = /\.xyz(\/|$)/i;
    if (xyzRegex.test(longUrl)) {
        return res.status(400).json({ error: "Links ending in .xyz are not allowed." });
    }

    if (!longUrl || !pin) {
        return res.status(400).json({ error: "URL and PIN are required." });
    }

    const shortId = Math.random().toString(36).substring(2, 8);
    
    const entry = {
        longUrl,
        pin,
        created: new Date().toISOString(),
        expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    };

    urls[shortId] = entry;
    bufferedSave();

    const shortUrl = `http://localhost:${PORT}/${shortId}`;
    try {
        const qrCodeData = await QRCode.toDataURL(shortUrl);
        res.status(201).json({ shortUrl, qrCodeData });
    } catch (err) {
        res.status(500).json({ error: "QR Generation failed." });
    }
});

app.get('/:id', (req, res) => {
    const data = urls[req.params.id];
    if (!data) return res.status(404).send("Link not found.");

    res.send(`
        <html>
            <body style="font-family: sans-serif; text-align: center; padding-top: 50px;">
                <h2>Enter PIN to access link</h2>
                <input type="password" id="pinInput" placeholder="Enter PIN">
                <button onclick="checkPin()">Submit</button>
                <script>
                    function checkPin() {
                        const pin = document.getElementById('pinInput').value;
                        if (pin === "${data.pin}") {
                            window.location.href = "/verify/${req.params.id}?pin=" + pin;
                        } else {
                            alert("Incorrect PIN");
                        }
                    }
                </script>
            </body>
        </html>
    `);
});


app.get('/verify/:id', rateLimiter, (req, res) => {
    const data = urls[req.params.id];
    
    if (data && req.query.pin === data.pin) {
        return res.redirect(302, data.longUrl);
    }
    res.status(400).send("Invalid PIN or Link.");
});

app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));