import numpy as np
import collections
import threading
import json
import requests
from mediapipe.tasks import python
from mediapipe.tasks.python import audio
from mediapipe.tasks.python.components import containers
from mediapipe.tasks.python.audio import audio_classifier
import mediapipe as mp
import time
import logging

class AudioDetector:
    def __init__(self, model_path, config_path, sample_rate=16000, buffer_duration=1.0):
        self.model_path = model_path
        self.config_path = config_path
        self.sample_rate = sample_rate
        self.buffer_size = int(buffer_duration * sample_rate)
        self.sources = {}  # Dict pour stocker les buffers et callbacks par source
        self.source_ids = {}  # Dict pour mapper les noms de source aux IDs numériques
        self.next_source_id = 1  # Commencer à 1 pour éviter les problèmes avec 0
        self.classifier = None
        self.running = False
        self.lock = threading.Lock()
        self.last_detection_time = {}  # Dict pour stocker le dernier temps de détection par type de son et source
        self.last_timestamp_ms = {}  # Dict pour stocker le dernier timestamp par source
        self.start_time_ms = None
        self.current_source_id = None  # Pour suivre la source actuelle dans le callback
        self.sound_configs = self._load_sound_configs()

    def _load_sound_configs(self):
        """Charge la configuration des sons à détecter"""
        try:
            with open(self.config_path, 'r') as f:
                config = json.load(f)
                return config.get('sound_detections', [])
        except Exception as e:
            logging.error(f"Erreur lors du chargement de la configuration des sons: {str(e)}")
            return []

    def _send_webhook(self, webhook_url, data):
        """Envoie un webhook avec les données de détection"""
        try:
            response = requests.post(webhook_url, json=data)
            response.raise_for_status()
            logging.info(f"Webhook envoyé avec succès à {webhook_url}")
        except Exception as e:
            logging.error(f"Erreur lors de l'envoi du webhook: {str(e)}")

    def initialize(self, max_results=5, score_threshold=0.3):
        """Initialise le classificateur audio"""
        try:
            base_options = python.BaseOptions(model_asset_path=self.model_path)
            
            # Créer un seul classificateur en mode stream
            options = audio.AudioClassifierOptions(
                base_options=base_options,
                running_mode=audio.RunningMode.AUDIO_STREAM,
                max_results=max_results,
                score_threshold=score_threshold,
                result_callback=self._handle_result
            )
            self.classifier = audio.AudioClassifier.create_from_options(options)
            self.running = True
            logging.info(f"Classificateur audio initialisé avec succès (sample_rate: {self.sample_rate}Hz)")
            logging.info(f"Options du classificateur: max_results={max_results}, score_threshold={score_threshold}")
        except Exception as e:
            logging.error(f"Erreur lors de l'initialisation du classificateur: {str(e)}")
            import traceback
            logging.error(traceback.format_exc())
            raise
        
    def add_source(self, source_id, detection_callback=None, labels_callback=None):
        """Ajoute une nouvelle source audio avec ses callbacks"""
        with self.lock:
            # Attribuer un ID numérique à la source
            numeric_id = self.next_source_id
            self.next_source_id += 1
            self.source_ids[source_id] = numeric_id
            
            self.sources[source_id] = {
                'buffer': collections.deque(maxlen=self.buffer_size),
                'detection_callback': detection_callback,
                'labels_callback': labels_callback,
                'numeric_id': numeric_id
            }
            self.last_detection_time[source_id] = 0
            self.last_timestamp_ms[source_id] = 0
            logging.info(f"Source audio ajoutée: {source_id} (ID interne: {numeric_id})")

    def remove_source(self, source_id):
        """Supprime une source audio"""
        with self.lock:
            if source_id in self.sources:
                numeric_id = self.sources[source_id]['numeric_id']
                del self.source_ids[source_id]
                del self.sources[source_id]
                del self.last_detection_time[source_id]
                del self.last_timestamp_ms[source_id]
                logging.info(f"Source audio supprimée: {source_id} (ID interne: {numeric_id})")

    def _handle_result(self, result, timestamp):
        """Gère les résultats de classification"""
        try:
            if not result or not result.classifications or not self.current_source_id:
                return
                
            classification = result.classifications[0]
            source_id = self.current_source_id
            current_time = time.time()
            
            # Pour chaque configuration de son
            for sound_config in self.sound_configs:
                sound_name = sound_config['name']
                labels = sound_config['labels']
                exclude_labels = sound_config.get('exclude_labels', [])
                threshold = sound_config['threshold']
                webhook_url = sound_config['webhook_url']
                cooldown = sound_config['cooldown']
                
                # Calculer le score pour ce type de son
                score_sum = sum(
                    category.score
                    for category in classification.categories
                    if category.category_name in labels
                )
                
                # Soustraire les scores des labels à exclure
                score_sum -= sum(
                    category.score
                    for category in classification.categories
                    if category.category_name in exclude_labels
                )
                
                # Vérifier si on a détecté ce son
                last_detection_key = f"{sound_name}_{source_id}"
                if (score_sum > threshold and 
                    (current_time - self.last_detection_time.get(last_detection_key, 0)) > cooldown):
                    
                    # Préparer les données pour le webhook
                    webhook_data = {
                        'timestamp': current_time,
                        'score': float(score_sum),
                        'source_id': source_id,
                        'sound_type': sound_name,
                        'detected_labels': [
                            {"label": cat.category_name, "score": float(cat.score)}
                            for cat in classification.categories
                            if cat.score > 0.1
                        ]
                    }
                    
                    # Envoyer le webhook
                    self._send_webhook(webhook_url, webhook_data)
                    self.last_detection_time[last_detection_key] = current_time
                    
                    logging.info(f"Son détecté: {sound_name} (score: {score_sum:.2f})")
                
        except Exception as e:
            logging.error(f"Erreur dans le traitement du résultat: {str(e)}")
            import traceback
            logging.error(traceback.format_exc())

    def process_audio(self, audio_data, source_id):
        """Traite les données audio pour une source spécifique"""
        try:
            if source_id not in self.sources:
                logging.warning(f"Source inconnue: {source_id}")
                return

            # Vérifier si le classificateur est actif
            if not self.running:
                logging.warning("Le classificateur n'est pas actif, démarrage...")
                self.start()
                if not self.running:
                    logging.error("Impossible de démarrer le classificateur")
                    return

            # Rééchantillonnage si nécessaire
            if len(audio_data) > self.buffer_size:
                resampled_data = audio_data[::3]
                audio_data = resampled_data
            
            # S'assurer que les données sont en float32
            if audio_data.dtype != np.float32:
                audio_data = audio_data.astype(np.float32)
            
            # Log des statistiques audio
            if len(audio_data) > 0:
                logging.debug(f"Audio stats (source {source_id}) - min: {np.min(audio_data):.4f}, max: {np.max(audio_data):.4f}, mean: {np.mean(audio_data):.4f}, std: {np.std(audio_data):.4f}")
            
            # Ajouter les nouvelles données au buffer de la source
            self.sources[source_id]['buffer'].extend(audio_data)
            
            # Traiter avec le classificateur
            if self.running and self.classifier and self.start_time_ms is not None:
                block_size = 1600
                buffer_array = np.array(list(self.sources[source_id]['buffer']))
                
                blocks_processed = 0  # Compteur pour le debug
                while len(buffer_array) >= block_size:
                    block = buffer_array[:block_size]
                    buffer_array = buffer_array[block_size:]
                    blocks_processed += 1
                    
                    # Vérifier les statistiques du bloc avant classification
                    block_max = np.max(np.abs(block))
                    if block_max > 0.1:  # Seulement log les blocs avec du son significatif
                        logging.debug(f"Classification d'un bloc audio (source {source_id}) - amplitude max: {block_max:.4f}")
                    
                    audio_data_container = containers.AudioData.create_from_array(
                        block,
                        self.sample_rate
                    )
                    
                    # Calculer le prochain timestamp
                    block_duration_ms = int((block_size / self.sample_rate) * 1000)
                    next_timestamp = max(
                        self.last_timestamp_ms.get(source_id, 0) + block_duration_ms,
                        int(time.time() * 1000)
                    )
                    self.last_timestamp_ms[source_id] = next_timestamp
                    
                    # Définir la source actuelle pour le callback
                    self.current_source_id = source_id
                    
                    # Log avant la classification
                    if block_max > 0.1:
                        logging.debug(f"Envoi au classificateur - source: {source_id}, timestamp: {next_timestamp}")
                    
                    # Classifier le bloc
                    try:
                        self.classifier.classify_async(audio_data_container, next_timestamp)
                    except Exception as e:
                        logging.error(f"Erreur lors de la classification: {str(e)}")
                
                if blocks_processed > 0:
                    logging.debug(f"Blocs traités pour {source_id}: {blocks_processed}")
                
                # Mettre à jour le buffer avec les données restantes
                self.sources[source_id]['buffer'].clear()
                if len(buffer_array) > 0:
                    self.sources[source_id]['buffer'].extend(buffer_array)
            
        except Exception as e:
            logging.error(f"Erreur dans le traitement audio: {e}")
            import traceback
            logging.error(traceback.format_exc())

    def start(self):
        """Démarre la détection"""
        if not self.classifier:
            self.initialize()
        
        # Réinitialiser les timestamps
        self.start_time_ms = int(time.time() * 1000)
        for source_id in self.sources:
            self.last_timestamp_ms[source_id] = self.start_time_ms
        
        # Démarrer le task runner de MediaPipe
        if self.classifier:
            try:
                # Créer un conteneur audio vide pour démarrer le stream
                empty_data = np.zeros(1600, dtype=np.float32)
                audio_data = containers.AudioData.create_from_array(
                    empty_data,
                    self.sample_rate
                )
                # Démarrer le stream avec le timestamp initial
                self.classifier.classify_async(audio_data, self.start_time_ms)
                self.running = True
                logging.info("Task runner MediaPipe démarré avec succès")
            except Exception as e:
                logging.error(f"Erreur lors du démarrage du task runner: {e}")
                return False
        
        self.running = True
        return True

    def stop(self):
        """Arrête le classificateur"""
        self.running = False
        if self.classifier:
            try:
                self.classifier.close()
                self.classifier = None
                logging.info("Classificateur audio arrêté")
            except Exception as e:
                logging.error(f"Erreur lors de l'arrêt du classificateur: {e}")
                
    def __del__(self):
        """Destructeur pour s'assurer que les classificateurs sont bien arrêtés"""
        self.stop()
