from flask_socketio import SocketIO
import logging

# Instance globale de Socket.IO
socketio = SocketIO()

def send_clap_event():
    """Envoie un événement de clap via Socket.IO"""
    socketio.emit('clap', {'message': 'Applaudissement détecté!'})

def send_labels(data):
    """Envoie les labels détectés via Socket.IO"""
    try:
        # Vérifier que les données sont valides
        if not isinstance(data, dict):
            logging.error(f"send_labels: données invalides - attendu dict, reçu {type(data)}")
            return

        # S'assurer que les labels sont dans le bon format
        if 'detected' not in data:
            logging.error("send_labels: clé 'detected' manquante dans les données")
            return

        # Log pour debug
        logging.debug(f"Envoi des labels via Socket.IO: {data}")
        
        # Émettre l'événement
        socketio.emit('labels', data)
        logging.debug("Labels envoyés avec succès")
    except Exception as e:
        logging.error(f"Erreur lors de l'envoi des labels: {str(e)}")
        import traceback
        logging.error(traceback.format_exc()) 