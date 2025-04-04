class SoundConfigManager {
    constructor() {
        this.config = null;
        this.yamnetLabels = [];
        this.loadConfig();
        this.loadYamnetLabels();
    }

    async loadConfig() {
        try {
            const response = await fetch('/api/sound-config');
            this.config = await response.json();
            this.updateUI();
        } catch (error) {
            console.error('Erreur lors du chargement de la configuration:', error);
        }
    }

    async loadYamnetLabels() {
        try {
            const response = await fetch('/api/yamnet-labels');
            const data = await response.json();
            this.yamnetLabels = data.labels;
            this.updateUI();
        } catch (error) {
            console.error('Erreur lors du chargement des labels YAMNet:', error);
        }
    }

    async saveConfig() {
        try {
            const response = await fetch('/api/sound-config', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(this.config)
            });
            const result = await response.json();
            if (result.status === 'success') {
                this.showNotification('Configuration sauvegardée avec succès', 'success');
            } else {
                this.showNotification('Erreur lors de la sauvegarde: ' + result.message, 'error');
            }
        } catch (error) {
            console.error('Erreur lors de la sauvegarde de la configuration:', error);
            this.showNotification('Erreur lors de la sauvegarde de la configuration', 'error');
        }
    }

    updateUI() {
        const container = document.getElementById('sound-detections');
        if (!container) return;

        container.innerHTML = '';
        
        this.config.sound_detections.forEach((detection, index) => {
            const detectionElement = this.createDetectionElement(detection, index);
            container.appendChild(detectionElement);
        });

        // Ajouter le bouton pour ajouter une nouvelle détection
        const addButton = document.createElement('button');
        addButton.className = 'btn btn-primary mt-3';
        addButton.textContent = 'Ajouter une détection';
        addButton.onclick = () => this.addNewDetection();
        container.appendChild(addButton);
    }

    createDetectionElement(detection, index) {
        const div = document.createElement('div');
        div.className = 'card mb-3';
        div.innerHTML = `
            <div class="card-body">
                <h5 class="card-title">Détection de son #${index + 1}</h5>
                <div class="form-group">
                    <label>Nom</label>
                    <input type="text" class="form-control" value="${detection.name}" data-field="name">
                </div>
                <div class="form-group">
                    <label>Labels à détecter</label>
                    <div class="labels-selector">
                        <button class="btn btn-outline-primary select-labels-btn" data-field="labels" data-index="${index}">
                            Sélectionner les labels (${detection.labels ? detection.labels.length : 0} sélectionnés)
                        </button>
                        <div class="selected-labels-display" data-field="labels" data-index="${index}">
                            ${this.createSelectedLabelsDisplay(detection.labels)}
                        </div>
                    </div>
                </div>
                <div class="form-group">
                    <label>Labels à exclure</label>
                    <div class="labels-selector">
                        <button class="btn btn-outline-primary select-labels-btn" data-field="exclude_labels" data-index="${index}">
                            Sélectionner les labels à exclure (${detection.exclude_labels ? detection.exclude_labels.length : 0} sélectionnés)
                        </button>
                        <div class="selected-labels-display" data-field="exclude_labels" data-index="${index}">
                            ${this.createSelectedLabelsDisplay(detection.exclude_labels || [])}
                        </div>
                    </div>
                </div>
                <div class="form-group">
                    <label>Seuil de détection</label>
                    <input type="number" class="form-control" value="${detection.threshold}" step="0.1" data-field="threshold">
                </div>
                <div class="form-group">
                    <label>URL du webhook</label>
                    <div class="webhook-input-with-test">
                        <input type="text" class="form-control" value="${detection.webhook_url}" data-field="webhook_url">
                        <button type="button" class="btn btn-outline-primary test-webhook" data-source="sound-${index}">
                            <span class="icon">🔔</span>
                            Tester
                        </button>
                    </div>
                </div>
                <div class="form-group">
                    <label>Temps de recharge (secondes)</label>
                    <input type="number" class="form-control" value="${detection.cooldown}" step="0.1" data-field="cooldown">
                </div>
                <button class="btn btn-danger delete-detection" data-index="${index}">Supprimer</button>
            </div>
        `;
        
        // Ajouter les écouteurs d'événements pour les champs
        const inputs = div.querySelectorAll('input[data-field]');
        inputs.forEach(input => {
            input.addEventListener('change', (e) => {
                const field = e.target.getAttribute('data-field');
                let value = e.target.value;
                
                if (field === 'threshold' || field === 'cooldown') {
                    value = parseFloat(value);
                }
                
                this.updateDetection(index, field, value);
            });
        });
        
        // Ajouter les écouteurs d'événements pour les boutons de sélection de labels
        const selectButtons = div.querySelectorAll('.select-labels-btn');
        selectButtons.forEach(button => {
            button.addEventListener('click', (e) => {
                const field = e.target.getAttribute('data-field');
                const index = parseInt(e.target.getAttribute('data-index'));
                this.showLabelsPopup(index, field);
            });
        });
        
        // Ajouter l'écouteur d'événements pour le bouton de suppression
        const deleteButton = div.querySelector('.delete-detection');
        deleteButton.addEventListener('click', () => {
            this.removeDetection(index);
        });
        
        // Ajouter l'écouteur d'événements pour le bouton de test du webhook
        const testButton = div.querySelector('.test-webhook');
        testButton.addEventListener('click', async () => {
            const webhookInput = div.querySelector('input[data-field="webhook_url"]');
            const webhookUrl = webhookInput.value;
            
            if (!webhookUrl) {
                this.showNotification('URL du webhook non définie', 'error');
                return;
            }
            
            // Sauvegarder le contenu original du bouton
            const buttonContent = testButton.innerHTML;
            
            try {
                testButton.disabled = true;
                testButton.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Test...';
                
                const response = await fetch('/api/webhook/test', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        source: `sound-${index}`,
                        url: webhookUrl
                    })
                });
                
                const result = await response.json();
                
                if (result.success) {
                    this.showNotification('Test du webhook réussi', 'success');
                } else {
                    this.showNotification(`Échec du test du webhook: ${result.error}`, 'error');
                }
            } catch (error) {
                this.showNotification(`Erreur lors du test du webhook: ${error.message}`, 'error');
            } finally {
                testButton.disabled = false;
                testButton.innerHTML = buttonContent;
            }
        });
        
        return div;
    }
    
    createSelectedLabelsDisplay(labels) {
        if (!labels || labels.length === 0) {
            return '<div class="no-labels-selected">Aucun label sélectionné</div>';
        }
        
        return `<div class="selected-labels">
            ${labels.map(label => `<span class="label-tag">${label}</span>`).join('')}
        </div>`;
    }
    
    showLabelsPopup(index, field) {
        // Créer la popup
        const popup = document.createElement('div');
        popup.className = 'labels-popup';
        popup.innerHTML = `
            <div class="labels-popup-content">
                <div class="labels-popup-header">
                    <h5>${field === 'labels' ? 'Sélectionner les labels à détecter' : 'Sélectionner les labels à exclure'}</h5>
                    <button class="close-popup">&times;</button>
                </div>
                <div class="labels-popup-search">
                    <input type="text" class="form-control" placeholder="Rechercher un label...">
                </div>
                <div class="labels-popup-actions">
                    <button class="btn btn-sm btn-outline-primary select-all-btn">Sélectionner tout</button>
                    <button class="btn btn-sm btn-outline-secondary deselect-all-btn">Désélectionner tout</button>
                </div>
                <div class="labels-popup-list">
                    ${this.createLabelsCheckboxes(index, field)}
                </div>
                <div class="labels-popup-footer">
                    <button class="btn btn-primary save-labels-btn">Enregistrer</button>
                    <button class="btn btn-secondary cancel-labels-btn">Annuler</button>
                </div>
            </div>
        `;
        
        // Ajouter la popup au document
        document.body.appendChild(popup);
        
        // Ajouter les écouteurs d'événements
        const closeBtn = popup.querySelector('.close-popup');
        const cancelBtn = popup.querySelector('.cancel-labels-btn');
        const saveBtn = popup.querySelector('.save-labels-btn');
        const selectAllBtn = popup.querySelector('.select-all-btn');
        const deselectAllBtn = popup.querySelector('.deselect-all-btn');
        const searchInput = popup.querySelector('.labels-popup-search input');
        
        // Fermer la popup
        closeBtn.addEventListener('click', () => {
            document.body.removeChild(popup);
        });
        
        cancelBtn.addEventListener('click', () => {
            document.body.removeChild(popup);
        });
        
        // Sélectionner/désélectionner tout
        selectAllBtn.addEventListener('click', () => {
            const checkboxes = popup.querySelectorAll('.labels-popup-list input[type="checkbox"]');
            checkboxes.forEach(checkbox => {
                checkbox.checked = true;
            });
        });
        
        deselectAllBtn.addEventListener('click', () => {
            const checkboxes = popup.querySelectorAll('.labels-popup-list input[type="checkbox"]');
            checkboxes.forEach(checkbox => {
                checkbox.checked = false;
            });
        });
        
        // Rechercher des labels
        searchInput.addEventListener('input', (e) => {
            const searchTerm = e.target.value.toLowerCase();
            const labels = popup.querySelectorAll('.labels-popup-list .label-item');
            
            labels.forEach(label => {
                const labelText = label.textContent.toLowerCase();
                if (labelText.includes(searchTerm)) {
                    label.style.display = '';
                } else {
                    label.style.display = 'none';
                }
            });
        });
        
        // Enregistrer les sélections
        saveBtn.addEventListener('click', () => {
            const selectedLabels = [];
            const checkboxes = popup.querySelectorAll('.labels-popup-list input[type="checkbox"]:checked');
            
            checkboxes.forEach(checkbox => {
                selectedLabels.push(checkbox.value);
            });
            
            this.updateDetection(index, field, selectedLabels);
            document.body.removeChild(popup);
        });
    }
    
    createLabelsCheckboxes(index, field) {
        if (!this.yamnetLabels || this.yamnetLabels.length === 0) {
            return '<div class="loading-labels">Chargement des labels...</div>';
        }
        
        const selectedLabels = this.config.sound_detections[index][field] || [];
        
        return this.yamnetLabels.map(label => {
            const isChecked = selectedLabels.includes(label) ? 'checked' : '';
            return `
                <div class="label-item">
                    <label>
                        <input type="checkbox" value="${label}" ${isChecked}>
                        ${label}
                    </label>
                </div>
            `;
        }).join('');
    }

    updateDetection(index, field, value) {
        this.config.sound_detections[index][field] = value;
        this.saveConfig();
        this.updateUI();
    }

    addNewDetection() {
        this.config.sound_detections.push({
            name: 'nouveau_son',
            labels: ['Hands', 'Clapping'],
            exclude_labels: [],
            threshold: 0.3,
            webhook_url: '',
            cooldown: 1.0
        });
        this.updateUI();
        this.saveConfig();
    }

    removeDetection(index) {
        this.config.sound_detections.splice(index, 1);
        this.updateUI();
        this.saveConfig();
    }

    showNotification(message, type = 'info') {
        // Créer l'élément de notification
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        
        // Ajouter la notification au document
        document.body.appendChild(notification);
        
        // Supprimer la notification après 3 secondes
        setTimeout(() => {
            document.body.removeChild(notification);
        }, 3000);
    }
}

// Initialiser le gestionnaire de configuration
const soundConfig = new SoundConfigManager();

// Rendre l'instance accessible globalement
window.soundConfig = soundConfig; 