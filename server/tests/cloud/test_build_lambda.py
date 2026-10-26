import hashlib
import importlib.util
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location('build_lambda', ROOT / 'tools' / 'build_lambda.py')
build_lambda = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build_lambda)


class BuildLambdaTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.zip_path = build_lambda.build(Path(cls.tmp.name) / 'api.zip')

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_contents(self):
        names = zipfile.ZipFile(self.zip_path).namelist()
        self.assertIn('server/cloud/handler.py', names)
        self.assertIn('pyluach/__init__.py', names)
        self.assertIn('tzdata/zoneinfo/Asia/Jerusalem', names)
        for unwanted in ('tests/', '__pycache__', 'server/app.py', 'server/store.py'):
            self.assertFalse([n for n in names if unwanted in n], unwanted)

    def test_deterministic(self):
        again = build_lambda.build(Path(self.tmp.name) / 'again.zip')
        digest = lambda p: hashlib.sha256(Path(p).read_bytes()).hexdigest()
        self.assertEqual(digest(self.zip_path), digest(again))

    def test_imports(self):
        with tempfile.TemporaryDirectory() as out:
            zipfile.ZipFile(self.zip_path).extractall(out)
            result = subprocess.run([sys.executable, '-I', '-c',
                                     "import os, sys; sys.path.insert(0, os.getcwd()); import server.cloud.handler, pyluach;"
                                     " assert pyluach.__file__.startswith(os.getcwd()), pyluach.__file__"], cwd=out,
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
