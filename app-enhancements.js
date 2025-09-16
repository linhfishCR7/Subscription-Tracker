/* ===== MODERN UI ENHANCEMENTS FOR SUBSCRIPTION TRACKER ===== */

// Notification System
class NotificationManager {
    constructor() {
        this.container = document.getElementById('notificationContainer');
        this.notifications = new Map();
    }

    show(message, type = 'info', duration = 5000, title = '') {
        const id = Date.now().toString();
        const notification = this.createNotification(id, message, type, title);
        
        this.container.appendChild(notification);
        this.notifications.set(id, notification);

        // Auto-remove after duration
        if (duration > 0) {
            setTimeout(() => this.remove(id), duration);
        }

        return id;
    }

    createNotification(id, message, type, title) {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.setAttribute('role', 'alert');
        notification.setAttribute('aria-live', 'polite');

        const icons = {
            success: '✅',
            error: '❌',
            warning: '⚠️',
            info: 'ℹ️'
        };

        notification.innerHTML = `
            <div class="notification-icon">${icons[type] || icons.info}</div>
            <div class="notification-content">
                ${title ? `<div class="notification-title">${title}</div>` : ''}
                <p class="notification-message">${message}</p>
            </div>
            <button class="notification-close" onclick="notifications.remove('${id}')" aria-label="Close notification">×</button>
            <div class="notification-progress"></div>
        `;

        return notification;
    }

    remove(id) {
        const notification = this.notifications.get(id);
        if (notification) {
            notification.style.animation = 'slideOutRight 0.3s ease forwards';
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
                this.notifications.delete(id);
            }, 300);
        }
    }

    clear() {
        this.notifications.forEach((_, id) => this.remove(id));
    }
}

// Loading Manager
class LoadingManager {
    constructor() {
        this.overlay = document.getElementById('loadingOverlay');
        this.activeLoaders = new Set();
    }

    show(message = 'Loading...') {
        this.activeLoaders.add(message);
        const loadingText = this.overlay.querySelector('.loading-text');
        if (loadingText) {
            loadingText.textContent = message;
        }
        this.overlay.style.display = 'flex';
        this.overlay.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';
    }

    hide(message = null) {
        if (message) {
            this.activeLoaders.delete(message);
        } else {
            this.activeLoaders.clear();
        }

        if (this.activeLoaders.size === 0) {
            this.overlay.style.display = 'none';
            this.overlay.setAttribute('aria-hidden', 'true');
            document.body.style.overflow = '';
        }
    }

    setButtonLoading(button, loading = true) {
        if (loading) {
            button.classList.add('btn-loading');
            button.disabled = true;
            button.setAttribute('aria-busy', 'true');
        } else {
            button.classList.remove('btn-loading');
            button.disabled = false;
            button.setAttribute('aria-busy', 'false');
        }
    }
}

// Modal Manager
class ModalManager {
    constructor() {
        this.modal = document.getElementById('confirmModal');
        this.title = document.getElementById('confirmTitle');
        this.message = document.getElementById('confirmMessage');
        this.confirmBtn = document.getElementById('confirmAction');
        this.cancelBtn = document.getElementById('confirmCancel');
        this.closeBtn = document.getElementById('closeModal');
        
        this.setupEventListeners();
    }

    setupEventListeners() {
        this.cancelBtn.addEventListener('click', () => this.hide());
        this.closeBtn.addEventListener('click', () => this.hide());
        
        // Close on backdrop click
        this.modal.addEventListener('click', (e) => {
            if (e.target === this.modal) {
                this.hide();
            }
        });

        // Close on Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isVisible()) {
                this.hide();
            }
        });
    }

    show(title, message, confirmText = 'Confirm', confirmClass = 'btn-danger') {
        return new Promise((resolve) => {
            this.title.textContent = title;
            this.message.textContent = message;
            this.confirmBtn.textContent = confirmText;
            this.confirmBtn.className = confirmClass;
            
            this.modal.style.display = 'flex';
            this.modal.setAttribute('aria-hidden', 'false');
            document.body.style.overflow = 'hidden';
            
            // Focus the first focusable element
            this.cancelBtn.focus();

            const handleConfirm = () => {
                this.hide();
                resolve(true);
                this.confirmBtn.removeEventListener('click', handleConfirm);
            };

            const handleCancel = () => {
                resolve(false);
            };

            this.confirmBtn.addEventListener('click', handleConfirm);
            this.cancelBtn.addEventListener('click', handleCancel, { once: true });
        });
    }

    hide() {
        this.modal.style.display = 'none';
        this.modal.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = '';
    }

    isVisible() {
        return this.modal.style.display === 'flex';
    }
}

// Tour System
class TourManager {
    constructor() {
        this.steps = [];
        this.currentStep = 0;
        this.overlay = null;
        this.tooltip = null;
        this.isActive = false;
        
        this.initializeTour();
    }

    initializeTour() {
        // Collect tour steps from DOM
        const tourElements = document.querySelectorAll('[data-tour-step]');
        this.steps = Array.from(tourElements)
            .map(el => ({
                element: el,
                step: parseInt(el.dataset.tourStep),
                title: el.dataset.tourTitle,
                description: el.dataset.tourDescription
            }))
            .sort((a, b) => a.step - b.step);
    }

    start() {
        if (this.steps.length === 0) return;
        
        this.isActive = true;
        this.currentStep = 0;
        this.createOverlay();
        this.showStep(0);
    }

    createOverlay() {
        this.overlay = document.createElement('div');
        this.overlay.className = 'tour-overlay';
        this.overlay.style.display = 'block';
        
        this.tooltip = document.createElement('div');
        this.tooltip.className = 'tour-tooltip';
        this.tooltip.setAttribute('role', 'dialog');
        this.tooltip.setAttribute('aria-labelledby', 'tour-title');
        this.tooltip.setAttribute('aria-describedby', 'tour-description');
        
        document.body.appendChild(this.overlay);
        document.body.appendChild(this.tooltip);
    }

    showStep(stepIndex) {
        if (stepIndex >= this.steps.length) {
            this.end();
            return;
        }

        const step = this.steps[stepIndex];
        const rect = step.element.getBoundingClientRect();
        
        // Create spotlight effect
        this.overlay.innerHTML = `
            <div class="tour-spotlight" style="
                top: ${rect.top - 10}px;
                left: ${rect.left - 10}px;
                width: ${rect.width + 20}px;
                height: ${rect.height + 20}px;
            "></div>
        `;

        // Position tooltip
        this.tooltip.innerHTML = `
            <h4 id="tour-title">${step.title}</h4>
            <p id="tour-description">${step.description}</p>
            <div class="tour-controls">
                <div class="tour-progress">${stepIndex + 1} of ${this.steps.length}</div>
                <div class="tour-buttons">
                    ${stepIndex > 0 ? '<button id="tour-prev" class="btn-secondary btn-small">Previous</button>' : ''}
                    <button id="tour-skip" class="btn-outline btn-small">Skip Tour</button>
                    <button id="tour-next" class="btn-small">${stepIndex === this.steps.length - 1 ? 'Finish' : 'Next'}</button>
                </div>
            </div>
        `;

        // Position tooltip
        const tooltipRect = this.tooltip.getBoundingClientRect();
        let top = rect.bottom + 20;
        let left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);

        // Adjust if tooltip goes off screen
        if (left < 20) left = 20;
        if (left + tooltipRect.width > window.innerWidth - 20) {
            left = window.innerWidth - tooltipRect.width - 20;
        }
        if (top + tooltipRect.height > window.innerHeight - 20) {
            top = rect.top - tooltipRect.height - 20;
        }

        this.tooltip.style.top = `${top}px`;
        this.tooltip.style.left = `${left}px`;

        // Add event listeners
        this.setupStepListeners();
        
        // Scroll element into view
        step.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    setupStepListeners() {
        const nextBtn = document.getElementById('tour-next');
        const prevBtn = document.getElementById('tour-prev');
        const skipBtn = document.getElementById('tour-skip');

        if (nextBtn) {
            nextBtn.addEventListener('click', () => {
                this.currentStep++;
                this.showStep(this.currentStep);
            });
        }

        if (prevBtn) {
            prevBtn.addEventListener('click', () => {
                this.currentStep--;
                this.showStep(this.currentStep);
            });
        }

        if (skipBtn) {
            skipBtn.addEventListener('click', () => this.end());
        }
    }

    end() {
        this.isActive = false;
        if (this.overlay) {
            document.body.removeChild(this.overlay);
            this.overlay = null;
        }
        if (this.tooltip) {
            document.body.removeChild(this.tooltip);
            this.tooltip = null;
        }
        
        notifications.show('Tour completed! You\'re ready to start tracking your subscriptions.', 'success', 3000, 'Welcome aboard!');
        
        // Mark tour as completed
        localStorage.setItem('tour-completed', 'true');
    }
}

// Initialize managers
const notifications = new NotificationManager();
const loading = new LoadingManager();
const modal = new ModalManager();
const tour = new TourManager();

// Export for global access
window.notifications = notifications;
window.loading = loading;
window.modal = modal;
window.tour = tour;
