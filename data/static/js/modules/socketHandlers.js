import { showNotification, showSuccess, showError } from './notifications.js';

export function initializeSocketIO() {
    console.log('🔌 Initializing Socket.IO...');
    
    // Configuration de Socket.IO
    const socket = io({
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        reconnectionAttempts: 5,
        transports: ['websocket', 'polling']  // Essayer WebSocket d'abord
    });
    
    // Événements de connexion
    socket.on('connect', () => {
        console.log('🟢 Socket.IO Connected with ID:', socket.id);
        // Envoyer un ping test au serveur
        socket.emit('ping_test', { time: Date.now() });
    });

    socket.on('disconnect', (reason) => {
        console.log('🔴 Socket.IO Disconnected:', reason);
    });

    socket.on('connect_error', (error) => {
        console.error('❌ Socket.IO Connection Error:', error);
    });

    socket.on('error', (error) => {
        console.error('❌ Socket.IO Error:', error);
    });

    // Gestionnaire pour le statut de détection
    socket.on('detection_status', (data) => {
        console.log('🔄 Detection status changed:', data);
        if (data.status === 'stopped') {
            const container = document.getElementById('detected_labels');
            if (container) {
                container.innerHTML = '';
                console.log('🔄 Labels container cleared');
            }
        }
    });

    // Test de réponse du serveur
    socket.on('pong_test', (data) => {
        console.log('🏓 Server responded to ping:', data);
    });
    
    // Gestionnaire pour les claps
    socket.on('clap', (data) => {
        console.log('🎯 Clap event received:', data);
        if (typeof window.showClap === 'function') {
            window.showClap(data.source_id);
        } else {
            console.error('❌ showClap function not found in window object');
        }
    });

    // Gestionnaire pour les labels
    socket.on('labels', (data) => {
        console.log('🏷️ Labels event received:', data);
        const container = document.getElementById('detected_labels');
        
        if (!container) {
            console.error('❌ Labels container not found');
            return;
        }

        // Vérifier la structure des données reçues
        if (!data || !data.detected || !Array.isArray(data.detected)) {
            console.warn('⚠️ Invalid labels data received:', data);
            container.innerHTML = '<span class="no-labels">En attente de détection...</span>';
            return;
        }

        // Filtrer les labels valides
        const validLabels = data.detected.filter(label => {
            const isValid = label && 
                typeof label.label === 'string' && 
                typeof label.score === 'number' &&
                label.score >= 0 && 
                label.score <= 1;
            
            if (!isValid) {
                console.warn('⚠️ Invalid label format:', label);
            }
            return isValid;
        });

        console.log('📊 Valid labels:', validLabels);

        if (validLabels.length === 0) {
            console.warn('⚠️ No valid labels in data:', data.detected);
            container.innerHTML = '<span class="no-labels">Aucun son détecté</span>';
            return;
        }

        // Trier les labels par score décroissant
        validLabels.sort((a, b) => b.score - a.score);

        // Vider le conteneur
        container.innerHTML = '';

        // Ajouter les nouveaux labels
        validLabels.forEach(label => {
            const labelElement = document.createElement('span');
            labelElement.className = 'label';
            const score = Math.round(label.score * 100);
            labelElement.innerHTML = `
                <span class="label-text">${label.label}</span>
                <span class="label-score">${score}%</span>
            `;
            container.appendChild(labelElement);
            
            console.log(`📌 Added label: ${label.label} (${score}%)`);
        });

        // Ajouter la source si elle est présente
        if (data.source) {
            const sourceElement = document.createElement('div');
            sourceElement.className = 'source-info';
            sourceElement.textContent = `Source: ${data.source}`;
            container.insertBefore(sourceElement, container.firstChild);
            console.log('🎯 Added source info:', data.source);
        }
    });

    // Retourner l'instance socket pour utilisation ailleurs si nécessaire
    return socket;
} 