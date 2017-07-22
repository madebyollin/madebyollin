import sys
import librosa
import os
os.environ["THEANO_FLAGS"] = "mode=FAST_RUN,device=gpu0,floatX=float32"
import numpy as np
import scipy
import theano
import theano.tensor as T
import lasagne
import skimage.io as io
from lasagne.utils import floatX
from lasagne.layers import InputLayer, Conv1DLayer as ConvLayer
from os.path import basename

if (not (sys.argv[1] and sys.argv[2])):
    print("Run like this: `fulltransfer.py content.mp3 style.mp3 alpha`")

CONTENT_FILENAME = sys.argv[1]
STYLE_FILENAME = sys.argv[2]
# The most frequent problem is domination of either content or style in the output. To fight this problem, adjust ALPHA parameter.
# Larger ALPHA means more content in the output, and ALPHA=0 means no content, which reduces stylization to texture generation.

ALPHA = 1e-2
if (sys.argv[3]):
    ALPHA = float(sys.argv[3])
    print("set ALPHA to " + str(ALPHA))
# # of pixels to clip to
CLIP = None

# Reads wav file and produces spectrum
# Fourier phases are ignored
N_FFT = 2048
def read_audio_spectum(filename):
    print("Attempting to read " + str(filename))
    x, fs = librosa.load(filename)
    S = librosa.stft(x, N_FFT)
    p = np.angle(S)
    # this initially sliced it at 430 px
    # return np.log1p(np.abs(S[np.newaxis,:,:430])), fs
    if not CLIP:
        return np.log1p(np.abs(S[np.newaxis,:,:])), fs
    else:
        return np.log1p(np.abs(S[np.newaxis,:,:CLIP])), fs


def save_spectrum_to_png(spectrum, filename):
    spectrum = spectrum[0,:,:]
    image = np.clip((spectrum - np.min(spectrum)) / (np.max(spectrum) - np.min(spectrum)), 0, 1)
    io.imsave(filename, image)

print("Loading audio files")

a_content, fs = read_audio_spectum(CONTENT_FILENAME)
print("Loaded " + CONTENT_FILENAME)
save_spectrum_to_png(a_content, basename(CONTENT_FILENAME) + " (Content).png")

a_style, fs = read_audio_spectum(STYLE_FILENAME)
print("Loaded " + STYLE_FILENAME)
save_spectrum_to_png(a_style, basename(STYLE_FILENAME) + " (Style).png")

N_SAMPLES = a_content.shape[2]
N_CHANNELS = a_content.shape[1]
a_style = a_style[:, :N_CHANNELS, :N_SAMPLES]


# ### Define net

# During our tests, we discovered that it is essential to use extremely large number of conv filters
# In this example we use single convolution with 4096 filters

N_FILTERS = 4096
inputs = InputLayer((1, N_CHANNELS, N_SAMPLES))
conv = ConvLayer(inputs, N_FILTERS, 11, W=lasagne.init.GlorotNormal(gain='relu'))

# Implementation of losses and optimization is based on artistic style transfer example in lasagne recipes
# https://github.com/Lasagne/Recipes/blob/master/examples/styletransfer/Art%20Style%20Transfer.ipynb
def gram_matrix(x):
    g = T.tensordot(x, x, axes=([2], [2])) / x.shape[2]
    return g

def style_loss(A, X,):
    G1 = gram_matrix(A)
    G2 = gram_matrix(X)
    loss = ((G1 - G2)**2).sum()
    return loss

def content_loss(A, X):
    return ((A - X)**2).sum()

t = np.zeros_like(a_content)

content_features = lasagne.layers.get_output(conv, a_content)
style_features = lasagne.layers.get_output(conv, a_style)

generated = T.tensor3()
gen_features = lasagne.layers.get_output(conv, generated)

loss = style_loss(style_features, gen_features) + ALPHA * content_loss(content_features, gen_features)
grad = T.grad(loss, generated)

f_loss = theano.function([generated], loss)
f_grad = theano.function([generated], grad)

def eval_loss(x0):
    x0 = floatX(x0.reshape((1, N_CHANNELS, N_SAMPLES)))
    return f_loss(x0).astype('float64')

def eval_grad(x0):
    x0 = floatX(x0.reshape((1, N_CHANNELS, N_SAMPLES)))
    return np.array(f_grad(x0)).flatten().astype('float64')


# ### Run optimization

# initialization with zeros or gaussian noise can be used
# zeros don't work with ALPHA=0
t = floatX(np.random.randn(1, N_CHANNELS, N_SAMPLES))
# t = floatX(np.zeros((1, N_CHANNELS, N_SAMPLES)))

print("Optimizing...")
res = scipy.optimize.fmin_l_bfgs_b(eval_loss, t.flatten(), fprime=eval_grad, maxfun=500, iprint=0)
t = res[0].reshape((1, N_CHANNELS, N_SAMPLES))

# ### Invert spectrogram and save the result

print("Inverting Spectrogram")

a = np.zeros_like(a_content[0])
a[:N_CHANNELS,:] = np.exp(t[0]) - 1

save_spectrum_to_png(t, basename(CONTENT_FILENAME) + " (" + basename(STYLE_FILENAME) + ').png')

# This code is supposed to do phase reconstruction
p = 2 * np.pi * np.random.random_sample(a.shape) - np.pi
for i in range(500):
    S = a * np.exp(1j*p)
    x = librosa.istft(S)
    p = np.angle(librosa.stft(x, N_FFT))

print("Saving Output")
OUTPUT_FILENAME = 'outputs/' + basename(CONTENT_FILENAME) + " (" + basename(STYLE_FILENAME) + ') ' + str(ALPHA) + '.wav'
librosa.output.write_wav(OUTPUT_FILENAME, x, fs)
