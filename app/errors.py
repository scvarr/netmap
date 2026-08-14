from typing import Any


class NetMapError(Exception):
    def __init__(self, code: str, message: str, details: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details or {}


class ValidationError(NetMapError):
    def __init__(self, message: str, details: dict[str, Any] | None = None) -> None:
        super().__init__("VALIDATION_ERROR", message, details)


class ModelError(NetMapError):
    def __init__(self, message: str, details: dict[str, Any] | None = None) -> None:
        super().__init__("MODEL_ERROR", message, details)

