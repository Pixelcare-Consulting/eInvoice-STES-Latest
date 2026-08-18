/**
 * Custom Toast Notification Utility
 * Lightweight implementation that doesn't conflict with existing styles
 */

class ToastNotification {
    constructor() {
        this.container = null;
        this.toastCounter = 0;
        this.createContainer();
        this.injectStyles();
    }

    createContainer() {
        if (!this.container) {
            this.container = document.createElement('div');
            this.container.id = 'custom-toast-container';
            this.container.className = 'custom-toast-container';
            document.body.appendChild(this.container);
        }
    }

    injectStyles() {
        if (document.getElementById('custom-toast-styles')) return;

        const styles = document.createElement('style');
        styles.id = 'custom-toast-styles';
        styles.textContent = `
            .custom-toast-container {
                position: fixed;
                top: 20px;
                right: 20px;
                z-index: 10000;
                pointer-events: none;
            }

            .custom-toast {
                background: white;
                border-radius: 8px;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
                border: 1px solid #e5e7eb;
                margin-bottom: 10px;
                padding: 12px 16px;
                min-width: 300px;
                max-width: 400px;
                display: flex;
                align-items: center;
                gap: 12px;
                pointer-events: auto;
                transform: translateX(100%);
                opacity: 0;
                transition: all 0.3s ease;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                font-size: 14px;
                line-height: 1.4;
            }

            .custom-toast.show {
                transform: translateX(0);
                opacity: 1;
            }

            .custom-toast.hide {
                transform: translateX(100%);
                opacity: 0;
            }

            .custom-toast-icon {
                flex-shrink: 0;
                width: 20px;
                height: 20px;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 12px;
                font-weight: bold;
            }

            .custom-toast-success .custom-toast-icon {
                background: #10b981;
                color: white;
            }

            .custom-toast-error .custom-toast-icon {
                background: #ef4444;
                color: white;
            }

            .custom-toast-content {
                flex: 1;
            }

            .custom-toast-title {
                font-weight: 600;
                color: #1f2937;
                margin: 0 0 2px 0;
            }

            .custom-toast-message {
                color: #6b7280;
                margin: 0;
                font-size: 13px;
            }

            .custom-toast-close {
                background: none;
                border: none;
                color: #9ca3af;
                cursor: pointer;
                padding: 0;
                width: 16px;
                height: 16px;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 14px;
                line-height: 1;
            }

            .custom-toast-close:hover {
                color: #6b7280;
            }
        `;
        document.head.appendChild(styles);
    }

    createToast(type, title, message = '', duration = 3000) {
        this.toastCounter++;
        const toastId = `toast-${this.toastCounter}`;

        const toast = document.createElement('div');
        toast.id = toastId;
        toast.className = `custom-toast custom-toast-${type}`;

        const icon = type === 'success' ? '✓' : '✕';

        toast.innerHTML = `
            <div class="custom-toast-icon">${icon}</div>
            <div class="custom-toast-content">
                <div class="custom-toast-title">${title}</div>
                ${message ? `<div class="custom-toast-message">${message}</div>` : ''}
            </div>
            <button class="custom-toast-close" onclick="window.toastNotification.removeToast('${toastId}')">&times;</button>
        `;

        this.container.appendChild(toast);

        // Trigger animation
        setTimeout(() => toast.classList.add('show'), 10);

        // Auto remove
        if (duration > 0) {
            setTimeout(() => this.removeToast(toastId), duration);
        }

        return toastId;
    }

    removeToast(toastId) {
        const toast = document.getElementById(toastId);
        if (toast) {
            toast.classList.add('hide');
            setTimeout(() => {
                if (toast.parentNode) {
                    toast.parentNode.removeChild(toast);
                }
            }, 300);
        }
    }

    /**
     * Show success toast notification
     * @param {string} title - Toast title
     * @param {string} message - Toast message (optional)
     * @param {number} duration - Duration in ms (optional, default 3000)
     */
    success(title, message = '', duration = 3000) {
        return this.createToast('success', title, message, duration);
    }

    /**
     * Show error toast notification
     * @param {string} title - Toast title
     * @param {string} message - Toast message (optional)
     * @param {number} duration - Duration in ms (optional, default 5000)
     */
    error(title, message = '', duration = 5000) {
        return this.createToast('error', title, message, duration);
    }

    /**
     * Show copy success toast - specialized for copy operations
     * @param {string} item - What was copied (e.g., "Invoice Number", "Text")
     * @param {string} value - The actual value that was copied (optional)
     */
    copySuccess(item, value = '') {
        const message = value ? `${value} copied to clipboard` : `${item} copied to clipboard`;
        return this.success('Copied!', message, 2000);
    }

    /**
     * Show profile update success toast - specialized for profile updates
     */
    profileUpdated() {
        return this.success('Profile Updated', 'Your profile has been updated successfully');
    }

    /**
     * Clear all toasts
     */
    clearAll() {
        const toasts = this.container.querySelectorAll('.custom-toast');
        toasts.forEach(toast => {
            this.removeToast(toast.id);
        });
    }
}

// Create global instance
window.toastNotification = new ToastNotification();

// For backward compatibility, also expose individual methods
window.showToast = {
    success: (title, message, duration) => window.toastNotification.success(title, message, duration),
    error: (title, message, duration) => window.toastNotification.error(title, message, duration),
    copySuccess: (item, value) => window.toastNotification.copySuccess(item, value),
    profileUpdated: () => window.toastNotification.profileUpdated()
};
