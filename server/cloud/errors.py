"""API errors are machine codes (snake_case). The app translates them; the server never sends prose."""


class ApiError(Exception):
    def __init__(self, status, code, field=None):
        self.status = status
        self.code = code
        self.field = field  # an optional short hint (a path such as `sections[0].rows[2].time`), never user data
        super().__init__(code)
