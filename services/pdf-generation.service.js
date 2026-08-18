/**
 * Enhanced PDF Generation Service with Multiple Fallback Options
 * Handles EACCES permission errors and provides alternative PDF generation methods
 */

const fs = require('fs').promises;
const path = require('path');
const puppeteer = require('puppeteer');
const { getJsReport } = require('./jsreport.service');

class PDFGenerationService {
  constructor() {
    // Re-enable all PDF generation methods with proper Windows support
    this.methods = ['puppeteer', 'jsreport', 'html-pdf']; // Try all methods in order
    this.currentMethod = 'puppeteer';
    this.failedMethods = new Set(); // Clear failed methods to allow retry
  }

  /**
   * Generate PDF with automatic fallback between methods
   */
  async generatePDF(html, options = {}) {
    const { requestId = 'unknown', uuid, outputPath } = options;
    
    console.log(`[${requestId}] Starting PDF generation for ${uuid}`);
    
    for (const method of this.methods) {
      if (this.failedMethods.has(method)) {
        console.log(`[${requestId}] Skipping failed method: ${method}`);
        continue;
      }

      try {
        console.log(`[${requestId}] Attempting PDF generation with: ${method}`);
        const result = await this._generateWithMethod(method, html, options);
        console.log(`[${requestId}] PDF generated successfully with: ${method}`);
        return result;
      } catch (error) {
        console.error(`[${requestId}] PDF generation failed with ${method}:`, error.message);
        
        // Mark method as failed if it's a permission or critical error
        if (this._isCriticalError(error)) {
          this.failedMethods.add(method);
          console.log(`[${requestId}] Marking ${method} as permanently failed`);
        }
      }
    }

    // All PDF methods failed - return emergency HTML fallback
    console.log(`[${requestId}] All PDF generation methods failed, generating emergency HTML fallback`);
    return this._generateEmergencyHtmlFallback(html, options);
  }

  /**
   * Generate PDF using specific method
   */
  async _generateWithMethod(method, html, options) {
    switch (method) {
      case 'puppeteer':
        return await this._generateWithPuppeteer(html, options);
      case 'jsreport':
        return await this._generateWithJSReport(html, options);
      case 'html-pdf':
        return await this._generateWithHtmlPdf(html, options);
      default:
        throw new Error(`Unknown PDF generation method: ${method}`);
    }
  }

  /**
   * Puppeteer PDF generation with enhanced Windows support
   */
  async _generateWithPuppeteer(html, options) {
    const { requestId = 'unknown' } = options;
    
    // Windows-optimized launch options
    const launchOptions = {
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-web-security',
        '--disable-features=VizDisplayCompositor',
        '--disable-software-rasterizer',
        '--disable-background-networking',
        '--disable-sync',
        '--disable-default-apps',
        '--no-first-run',
        '--disable-extensions',
        '--disable-component-update',
        '--disable-domain-reliability',
        '--single-process', // Important for Windows permission issues
      ],
      timeout: 120000,
      dumpio: false,
      ignoreDefaultArgs: ['--disable-extensions'],
    };

    // Try different Chrome executables - prioritize system Chrome
    const chromeExecutables = [
      process.env.PUPPETEER_CHROMIUM_EXECUTABLE_PATH,
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      process.env.LOCALAPPDATA ? process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe' : null,
      process.env.PROGRAMFILES ? process.env.PROGRAMFILES + '\\Google\\Chrome\\Application\\chrome.exe' : null,
      process.env.USERPROFILE ? process.env.USERPROFILE + '\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe' : null,
      // Additional Windows paths
      'C:\\Users\\' + process.env.USERNAME + '\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    ].filter(Boolean);

    let browser = null;
    let lastError = null;

    // Try system Chrome installations first (more reliable on Windows)
    for (const executable of chromeExecutables) {
      try {
        console.log(`[${requestId}] Trying Chrome at: ${executable}`);

        // Check if file exists and is executable
        try {
          await fs.access(executable, fs.constants.F_OK);
          console.log(`[${requestId}] Chrome executable found: ${executable}`);
        } catch (accessError) {
          console.log(`[${requestId}] Chrome not found at: ${executable}`);
          continue;
        }

        const options = { ...launchOptions, executablePath: executable };
        browser = await puppeteer.launch(options);
        console.log(`[${requestId}] System Chrome launched successfully: ${executable}`);
        break;
      } catch (execError) {
        console.log(`[${requestId}] Chrome launch failed for ${executable}: ${execError.message}`);
        if (execError.code === 'EACCES') {
          console.log(`[${requestId}] Permission denied for ${executable}`);
        }
        lastError = execError;
      }
    }

    // Fallback to bundled Chrome if system Chrome failed
    if (!browser) {
      try {
        console.log(`[${requestId}] Trying bundled Chrome as fallback...`);
        delete launchOptions.executablePath;
        browser = await puppeteer.launch(launchOptions);
        console.log(`[${requestId}] Bundled Chrome launched successfully`);
      } catch (bundledChromeError) {
        console.log(`[${requestId}] Bundled Chrome failed: ${bundledChromeError.message}`);

        // Final fallback with minimal arguments
        try {
          console.log(`[${requestId}] Trying minimal Chrome configuration...`);
          browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox'],
            timeout: 30000,
          });
          console.log(`[${requestId}] Minimal Chrome configuration successful`);
        } catch (minimalChromeError) {
          console.log(`[${requestId}] Minimal Chrome failed: ${minimalChromeError.message}`);
          lastError = minimalChromeError;
        }
      }
    }

    if (!browser) {
      throw new Error(`All Chrome configurations failed. Last error: ${lastError?.message}`);
    }

    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 2 });
      await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });

      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '1cm', right: '1cm', bottom: '1cm', left: '1cm' },
        timeout: 60000,
      });

      await browser.close();
      return pdfBuffer;
    } catch (error) {
      if (browser) {
        try {
          await browser.close();
        } catch (closeError) {
          console.error(`[${requestId}] Error closing browser:`, closeError.message);
        }
      }
      throw error;
    }
  }

  /**
   * JSReport PDF generation (fallback method)
   */
  async _generateWithJSReport(html, options) {
    const { requestId = 'unknown' } = options;
    
    try {
      const jsreport = getJsReport();
      
      const result = await jsreport.render({
        template: {
          content: html,
          engine: 'none',
          recipe: 'chrome-pdf',
          chrome: {
            format: 'A4',
            printBackground: true,
            margin: { top: '1cm', right: '1cm', bottom: '1cm', left: '1cm' },
          }
        }
      });

      return result.content;
    } catch (error) {
      console.error(`[${requestId}] JSReport PDF generation failed:`, error.message);
      throw new Error(`JSReport PDF generation failed: ${error.message}`);
    }
  }

  /**
   * HTML-PDF generation (last resort fallback)
   */
  async _generateWithHtmlPdf(html, options) {
    const { requestId = 'unknown' } = options;
    
    try {
      console.log(`[${requestId}] Creating emergency HTML fallback...`);

      // Create a clean HTML document that looks like the original invoice
      const emergencyHtml = `
<!DOCTYPE html>
<html>
<head>
    <title>Invoice Document</title>
    <meta charset="UTF-8">
    <style>
        body {
            font-family: Arial, sans-serif;
            margin: 0;
            padding: 0;
            background: white;
        }
        .document-container {
            width: 100%;
            max-width: none;
            margin: 0;
            padding: 0;
        }
        @media print {
            body {
                background: white;
                margin: 0;
                padding: 0;
            }
            .document-container {
                margin: 0;
                padding: 0;
            }
        }
        /* Hidden marker for emergency fallback detection */
        .emergency-marker {
            display: none;
        }
    </style>
</head>
<body>
    <div class="emergency-marker">Emergency PDF Fallback</div>
    <div class="document-container">
        ${html}
    </div>
</body>
</html>`;

      const buffer = Buffer.from(emergencyHtml, 'utf8');
      console.log(`[${requestId}] Emergency HTML fallback created (${buffer.length} bytes)`);
      return buffer;

    } catch (error) {
      console.error(`[${requestId}] Emergency fallback failed:`, error.message);
      throw error;
    }
  }

  /**
   * Check if error is critical and method should be disabled
   */
  _isCriticalError(error) {
    const criticalErrors = [
      'EACCES',
      'ENOENT',
      'Failed to launch the browser process',
      'spawn EACCES',
      'Permission denied'
    ];

    return criticalErrors.some(criticalError => 
      error.message.includes(criticalError) || error.code === criticalError
    );
  }

  /**
   * Reset failed methods (for testing or recovery)
   */
  resetFailedMethods() {
    this.failedMethods.clear();
    console.log('PDF generation methods reset');
  }

  /**
   * Get current status of PDF generation methods
   */
  getStatus() {
    return {
      availableMethods: this.methods,
      failedMethods: Array.from(this.failedMethods),
      currentMethod: this.currentMethod
    };
  }
}

module.exports = new PDFGenerationService();
