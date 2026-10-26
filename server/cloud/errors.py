"""API errors are machine codes (snake_case). The app translates them; the server never sends prose."""


class ApiError(Exception):
    def __init__(self, status, code):
        self.status = status
        self.code = code
        super().__init__(code)
