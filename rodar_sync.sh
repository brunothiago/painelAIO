#!/bin/bash
# Atalho para rodar a sincronização à mão no Mac: ./rodar_sync.sh
# O trabalho fica em rodar_sync.py (é ele que o agendamento chama).
cd "$(dirname "$0")"
exec .venv/bin/python3 rodar_sync.py "$@"
